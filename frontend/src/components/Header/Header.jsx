import BrandMark from "../BrandMark/BrandMark";
import HeaderAccountMenu from "../HeaderAccountMenu/HeaderAccountMenu.jsx";
import ThemeToggle from "../ThemeToggle/ThemeToggle";
import { displayUserName } from "../../services/displayUserName";
import "./Header.css";

export default function Header({ user, onLogout, operationLoading = false }) {
  const displayName = displayUserName(user);
  const nameParts = user?.full_name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const mobileDisplayName = nameParts.length > 1
    ? `${nameParts[0]} ${nameParts[nameParts.length - 1]}`
    : nameParts[0] ?? "";

  return (
    <header className="header">
      <div className="header__inner">
        <div className="header__brand">
          <span className="header__brand-mark">
            <BrandMark />
          </span>
          <div className="header__brand-copy">
            <p className="header__brand-name">TCQ Clinic</p>
          </div>
        </div>

        <div className="header__account">
          {displayName && (
            <div className={`header__identity${mobileDisplayName ? "" : " header__identity--no-mobile-name"}`}>
              <span className="header__identity-details">
                <span className="header__identity-label">Usuário</span>
                <strong className="header__identity-name header__identity-name--desktop">{displayName}</strong>
                {mobileDisplayName && (
                  <strong className="header__identity-name header__identity-name--mobile">
                    {mobileDisplayName}
                  </strong>
                )}
              </span>
            </div>
          )}

          <div className="header__actions">
            <ThemeToggle />
            <HeaderAccountMenu onLogout={onLogout} operationLoading={operationLoading} />
          </div>
        </div>

        <p className="header__status" role="status" aria-live="polite">
          {operationLoading ? "Aguarde, processando solicitação..." : ""}
        </p>
      </div>
    </header>
  );
}
