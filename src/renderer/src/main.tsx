import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'

// Deliberately not wrapped in StrictMode: its double-invoked effects would
// open two backends (and two SSH logins) for every terminal tab.
createRoot(document.getElementById('root')!).render(<App />)
