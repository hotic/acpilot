import type { ComponentProps } from 'react';
import type { ExtraProps } from 'streamdown';
import { vscodeApi } from '../vscodeApi';

// Links in agent output: the webview cannot navigate, so clicks are forwarded to the host (openExternal).
// LAB has no acquireVsCodeApi; there we fall back to a plain window.open.
const hasApi = typeof acquireVsCodeApi === 'function';

function openExternal(url: string) {
  if (hasApi) vscodeApi().postMessage({ type: 'openExternal', url });
  else window.open(url, '_blank', 'noopener');
}

// ExtraProps: streamdown passes the hast node along; unused here but part of the component contract
export function Link({ href, children, node: _node, ...rest }: ComponentProps<'a'> & ExtraProps) {
  return (
    <a
      href={href}
      onClick={e => {
        e.preventDefault();
        if (!href) return;
        // Fragment links (GFM footnotes / back-references) stay in-page; only real URLs go external
        if (href.startsWith('#')) document.getElementById(href.slice(1))?.scrollIntoView();
        else openExternal(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
