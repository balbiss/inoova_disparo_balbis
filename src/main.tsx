import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { getToken, getUsuario } from './lib/api';
import { AppShell } from './components/AppShell';
import Login from './pages/Login';
import Painel from './pages/Painel';
import Conexoes from './pages/Conexoes';
import Contatos from './pages/Contatos';
import Campanhas from './pages/Campanhas';
import NovaCampanha from './pages/NovaCampanha';
import CampanhaDetalhe from './pages/CampanhaDetalhe';
import Equipe from './pages/Equipe';
import Conversas from './pages/Conversas';
import Grupos from './pages/Grupos';
import Empresas from './pages/Empresas';
import Seguranca from './pages/Seguranca';

function Protegida({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />;
}

function Inicio() {
  const u = getUsuario();
  if (!getToken() || !u) return <Navigate to="/login" replace />;
  return <Navigate to={u.role === 'superadmin' ? '/empresas' : '/painel'} replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protegida><AppShell /></Protegida>}>
          <Route path="/painel" element={<Painel />} />
          <Route path="/campanhas" element={<Campanhas />} />
          <Route path="/campanhas/nova" element={<NovaCampanha />} />
          <Route path="/campanhas/:id" element={<CampanhaDetalhe />} />
          <Route path="/conversas" element={<Conversas />} />
          <Route path="/contatos" element={<Contatos />} />
          <Route path="/grupos" element={<Grupos />} />
          <Route path="/conexoes" element={<Conexoes />} />
          <Route path="/equipe" element={<Equipe />} />
          <Route path="/empresas" element={<Empresas />} />
          <Route path="/seguranca" element={<Seguranca />} />
        </Route>
        <Route path="*" element={<Inicio />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
