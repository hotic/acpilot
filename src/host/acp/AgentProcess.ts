import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentDef } from './AgentRegistry';

// What the client side has to accept: updates / permission requests / file reads & writes / questions the agent sends on its own initiative.
// The optional handlers double as capability switches: a handler present is advertised in initialize, an absent one answers method-not-found
export interface ClientHandlers {
  onUpdate: (n: acp.SessionNotification) => void;
  onPermission: (req: acp.RequestPermissionRequest, signal: AbortSignal) => Promise<acp.RequestPermissionResponse>;
  onReadFile?: (req: acp.ReadTextFileRequest) => Promise<acp.ReadTextFileResponse>;
  onWriteFile?: (req: acp.WriteTextFileRequest) => Promise<void>;
  // Form elicitation (elicitation/create with mode=form): the agent asks the user for structured input, e.g. Devin's ask_user_question
  onElicitation?: (req: acp.CreateElicitationRequest, signal: AbortSignal) => Promise<acp.CreateElicitationResponse>;
  onStderr?: (line: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export const CLIENT_INFO = { name: 'acpilot', version: '0.0.1' };

// One agent subprocess = one long-lived ACP connection. stdio carries ndjson; stderr goes line by line to the Output Channel
export class AgentProcess {
  private constructor(
    readonly def: AgentDef,
    readonly child: ChildProcessByStdio<Writable, Readable, Readable>,
    readonly conn: acp.ClientConnection,
    readonly init: acp.InitializeResponse,
  ) {}

  get agent(): acp.ClientContext { return this.conn.agent; }
  get alive(): boolean { return this.child.exitCode === null && !this.child.killed; }

  // extraEnv: variables injected by the account layer per identity, layered on top of the agent definition's env
  static async spawn(def: AgentDef, binary: string, cwd: string, h: ClientHandlers, extraEnv?: Record<string, string>): Promise<AgentProcess> {
    const child = spawn(binary, def.args, {
      cwd,
      env: { ...process.env, ...def.env, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    createInterface({ input: child.stderr }).on('line', line => h.onStderr?.(line));
    child.on('exit', (code, signal) => h.onExit?.(code, signal));

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const app = acp.client({ name: 'acpilot' })
      .onNotification(acp.methods.client.session.update, ctx => { h.onUpdate(ctx.params); })
      .onRequest(acp.methods.client.session.requestPermission, ctx => h.onPermission(ctx.params, ctx.signal))
      .onRequest(acp.methods.client.fs.readTextFile, ctx => {
        if (!h.onReadFile) throw acp.RequestError.methodNotFound(acp.methods.client.fs.readTextFile);
        return h.onReadFile(ctx.params);
      })
      .onRequest(acp.methods.client.fs.writeTextFile, async ctx => {
        if (!h.onWriteFile) throw acp.RequestError.methodNotFound(acp.methods.client.fs.writeTextFile);
        await h.onWriteFile(ctx.params);
        return {};
      })
      .onRequest(acp.methods.client.elicitation.create, ctx => {
        if (!h.onElicitation) throw acp.RequestError.methodNotFound(acp.methods.client.elicitation.create);
        return h.onElicitation(ctx.params, ctx.signal);
      });
    const conn = app.connect(stream);

    const exited = new Promise<never>((_, reject) => {
      child.once('exit', (code, signal) => reject(new Error(`${def.command} 退出（code ${code ?? '-'}, signal ${signal ?? '-'}）`)));
      child.once('error', reject);
    });
    const initReq: acp.InitializeRequest = {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: CLIENT_INFO,
      clientCapabilities: {
        fs: { readTextFile: !!h.onReadFile, writeTextFile: !!h.onWriteFile },
        terminal: false,
        ...(h.onElicitation ? { elicitation: { form: {} } } : {}),
      },
    };
    const init: acp.InitializeResponse = await Promise.race([conn.agent.request(acp.methods.agent.initialize, initReq), exited]);
    return new AgentProcess(def, child, conn, init);
  }

  kill() {
    this.conn.close();
    if (this.alive) this.child.kill();
  }
}
