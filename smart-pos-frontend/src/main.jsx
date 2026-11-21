import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { hydrateTokenStore } from './lib/tokenStore'
import { startConnectivityMonitor } from './lib/connectivity'
import { API_BASE } from './lib/apiClient'

// In the desktop app the saved sign-in is read from the OS-backed secure store
// before first render, so AuthProvider sees it synchronously. In a browser this
// resolves immediately and nothing changes.
hydrateTokenStore().finally(() => {
  // Server-reachability heartbeat (also fed by every API call). See lib/connectivity.js.
  startConnectivityMonitor({ healthUrl: `${API_BASE}/health` })
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
