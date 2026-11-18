import { useEffect, useId, useRef, useState } from "react";
import Button from "../Button/Button";
import MenuIcon from "../Menu/MenuIcon.jsx";
import "./HeaderAccountMenu.css";

export default function HeaderAccountMenu({ onLogout, operationLoading = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;

    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    function closeOnNavigation() {
      setOpen(false);
    }

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    window.addEventListener("hashchange", closeOnNavigation);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      window.removeEventListener("hashchange", closeOnNavigation);
    };
  }, [open]);

  function handleKeyDown(event) {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    triggerRef.current?.focus();
  }

  function closeMenu() {
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="header-account-menu" onKeyDown={handleKeyDown}>
      <Button
        ref={triggerRef}
        className="header-account-menu__trigger theme-toggle"
        variant="secondary"
        aria-label="Minha conta"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <MenuIcon name="account" />
      </Button>
      <nav
        id={panelId}
        className="header-account-menu__panel"
        aria-label="Opções da conta"
        hidden={!open}
      >
        <ul>
          <li>
            <a href="#/minha-conta" onClick={closeMenu}>
              <MenuIcon name="profile" />
              Meu perfil
            </a>
          </li>
          <li>
            <a href="#/alterar-senha" onClick={closeMenu}>
              <MenuIcon name="key" />
              Alterar senha
            </a>
          </li>
          <li>
            <button
              type="button"
              className="header-account-menu__logout"
              disabled={operationLoading}
              onClick={() => {
                closeMenu();
                onLogout?.();
              }}
            >
              <MenuIcon name="logout" />
              Sair
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
