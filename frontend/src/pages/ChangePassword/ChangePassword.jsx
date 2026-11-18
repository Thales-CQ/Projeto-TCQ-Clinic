import PasswordForm from "../../components/PasswordForm/PasswordForm";
import usePasswordForm from "../../features/users/hooks/usePasswordForm";
import { useNavigation } from "../../hooks/useNavigation";

export default function ChangePassword() {
  const { navigate } = useNavigation();
  const password = usePasswordForm({ mode: "own" });
  return <PasswordForm showCurrentPassword {...password} onCancel={() => navigate("meu-perfil")} />;
}
