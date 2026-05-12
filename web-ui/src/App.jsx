import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './context/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import { NotificationProvider } from './context/NotificationContext'
import DashboardLayout from './layout/DashboardLayout'
import Login from './pages/Login'
import TlsManagement from './pages/TlsManagement'

export default function App() {
  const { isAuthenticated } = useAuth()

  const getBasename = () => {
    const path = window.location.pathname;
    const idx = path.indexOf('/tls-manager');
    return idx !== -1 ? path.substring(0, idx + '/tls-manager'.length) : '/tls-manager';
  };

  return (
    <NotificationProvider>
      <BrowserRouter basename={getBasename()}>
        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated ? <Navigate to="/tls" replace /> : <Login />
            }
          />
          <Route
            path="/tls"
            element={
              <ProtectedRoute>
                <DashboardLayout>
                  <TlsManagement />
                </DashboardLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={<Navigate to={isAuthenticated ? '/tls' : '/login'} replace />}
          />
          <Route
            path="*"
            element={<Navigate to={isAuthenticated ? '/tls' : '/login'} replace />}
          />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  )
}
