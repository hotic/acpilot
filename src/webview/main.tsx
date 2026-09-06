import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist';
import './styles/tokens.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
