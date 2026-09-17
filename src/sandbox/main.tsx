import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../app/tokens.css'
import { Sandbox } from './Sandbox'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sandbox />
  </StrictMode>,
)
