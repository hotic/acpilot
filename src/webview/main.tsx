import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist';
import 'katex/dist/katex.min.css';
import './styles/index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
