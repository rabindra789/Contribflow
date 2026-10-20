import { createRoot } from 'react-dom/client';
import App from './App';
import '@/styles/main.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Dashboard root element is missing');
}

createRoot(container).render(<App />);
