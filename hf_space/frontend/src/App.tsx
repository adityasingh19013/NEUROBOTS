import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ProjectLayout from "./components/ProjectLayout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import AuditLog from "./pages/AuditLog";
import Dashboard from "./pages/Dashboard";
import DataQuality from "./pages/DataQuality";
import Login from "./pages/Login";
import Mapping from "./pages/Mapping";
import Metrics from "./pages/Metrics";
import Projects from "./pages/Projects";
import ReportPage from "./pages/Report";
import SettingsPage from "./pages/Settings";
import Upload from "./pages/Upload";

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Signing in…" />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="upload" replace />} />
          <Route path="upload" element={<Upload />} />
          <Route path="map" element={<Mapping />} />
          <Route path="clean" element={<DataQuality />} />
          <Route path="metrics" element={<Metrics />} />
          <Route path="report" element={<ReportPage />} />
          <Route path="audit" element={<AuditLog embedded />} />
        </Route>
        <Route path="audit" element={<AuditLog />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
