import { useEffect, useRef } from "react";
import { useAuth } from "./hooks/useAuth";
import { useNavigation } from "./hooks/useNavigation";
import { canAccessDestination, isAdminAwaitingCepPermission, navigationForUser } from "./routes/navigation";
import AuthLayout from "./layouts/AuthLayout/AuthLayout";
import MainLayout from "./layouts/MainLayout/MainLayout";
import Login from "./pages/Login/Login";
import Dashboard from "./pages/Dashboard/Dashboard";
import Patients from "./features/patients/PatientsFeature.jsx";
import Users from "./features/users/UsersFeature.jsx";
import Profiles from "./features/profiles/ProfilesFeature.jsx";
import IntegrationFeature from "./features/settings/IntegrationFeature.jsx";
import ChangePassword from "./pages/ChangePassword/ChangePassword";
import Button from "./components/Button/Button";

export default function App() {
  const {
    initialLoading, initialCheckFailed, isAuthenticated,
    operationLoading, retrySessionCheck, user,
  } = useAuth();
  const { destination, navigate } = useNavigation();
  const awaitingLogin = useRef(false);

  useEffect(() => {
    if (initialLoading || initialCheckFailed) return;
    if (isAuthenticated && awaitingLogin.current) navigate("inicio");
    awaitingLogin.current = !isAuthenticated;
  }, [initialLoading, initialCheckFailed, isAuthenticated, navigate]);

  if (initialLoading) {
    return <AuthLayout><p role="status">Carregando...</p></AuthLayout>;
  }
  if (initialCheckFailed) {
    return (
      <AuthLayout>
        <p role="alert">Não foi possível conectar ao sistema. Tente novamente.</p>
        {operationLoading && <p role="status">Carregando...</p>}
        <Button disabled={operationLoading} onClick={retrySessionCheck}>
          Tentar novamente
        </Button>
      </AuthLayout>
    );
  }
  const destinationAllowed = canAccessDestination(destination, user);
  const administratorAccessPending = isAdminAwaitingCepPermission(destination, user);
  return isAuthenticated ? (
    <MainLayout navigationItems={navigationForUser(user)} currentDestination={destination}>
      {!destinationAllowed ? (
        <p role="alert">Você não tem permissão para acessar esta página.</p>
      ) : destination.id === "pacientes" ? (
        <Patients
          view={destination.view}
          onViewChange={(view) => navigate(`pacientes-${view}`)}
        />
      ) : destination.id === "usuarios" ? (
        <Users
          key={destination.routeId}
          view={destination.view}
          onViewChange={(view) => navigate(`usuarios-${view}`)}
        />
      ) : destination.id === "perfis" ? (
        <Profiles
          view={destination.view}
          onViewChange={(view) => navigate(`perfis-${view}`)}
        />
      ) : destination.id === "integracao" ? (
        <IntegrationFeature
          key={administratorAccessPending ? "activation-pending" : "available"}
          permissions={user?.permissions ?? []}
          administratorAccessPending={administratorAccessPending}
        />
      ) : destination.id === "alterar-senha" ? (
        <ChangePassword />
      ) : (
        <Dashboard
          user={user}
        />
      )}
    </MainLayout>
  ) : <Login />;
}
