import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Authenticator } from '@aws-amplify/ui-react'
import { AppLayout } from './components/common/Layout'
import HomePage from './pages/HomePage/HomePage'
import ClipEditorPage from './pages/ClipEditorPage/ClipEditorPage'
import ChannelsPage from './pages/ChannelsPage/ChannelsPage'
import DocumentationPage from './pages/DocumentationPage/DocumentationPage'
import { PreferencesProvider } from './contexts/PreferencesContext'

import {fetchAuthSession} from "@aws-amplify/auth";
import { useEffect, useState } from 'react'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  useEffect(() => {
    const getAuthSession = async () => {
      const authSession = await fetchAuthSession();
      if (authSession) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    }
    getAuthSession().then();
  }, [])

  const authenticatorComponents = {
    Header() {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0", gap: "4px", background: "#131920", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "500px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/aws-elemental-inference_64.png" alt="Logo" style={{ height: "50px", borderRadius: "5px"}} />
            <div style={{ fontSize: "28px", fontWeight: 500, color: "#fff" }}>AWS Elemental Inference</div>
          </div>
          <div style={{ fontSize: "22px", fontWeight: 500, color: "#fff" }}>Clipping &amp; Cropping</div>
        </div>
      );
    },
    Footer() {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", padding: "20px 0", background: "#131920", borderRadius: "0 0 20px 20px", width: "100%", maxWidth: "500px" }}>
          <img src="/aws-logo-white.png" alt="Logo" style={{ height: "50px" }} />
        </div>
      );
    }
  };

  return (
    <div style={{ display: "flex",flexDirection: "column", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: "#eee"}}>
      {/* <Authenticator hideSignUp> */}
      <Authenticator components={authenticatorComponents} hideSignUp>
        <PreferencesProvider>
        <Router>
          <AppLayout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/channels" element={<ChannelsPage />} />
              <Route path="/video-editor" element={<ClipEditorPage />} />
              <Route path="/docs" element={<DocumentationPage />} />
            </Routes>
          </AppLayout>
        </Router>
        </PreferencesProvider>
      </Authenticator>
    </div>
  )
}

export default App
