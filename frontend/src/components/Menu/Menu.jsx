import { useEffect, useId, useRef, useState } from "react";
import MenuIcon from "./MenuIcon.jsx";
import { toggleMenuPath } from "./menuState.js";
import "./Menu.css";

export default function Menu({ items = [], currentDestination }) {
  const [openIds, setOpenIds] = useState([]);
  const menuRef = useRef(null);
  const triggerRefs = useRef({});
  const menuPrefix = useId();
  const activeModuleId = currentDestination?.moduleId ?? currentDestination?.id;
  const activeRouteId = currentDestination?.routeId ?? currentDestination?.id;
  const openItem = items.find((item) => item.id === openIds[0] && item.children?.length);
  const submenuTitleId = openItem ? `${menuPrefix}-submenu-title` : undefined;

  useEffect(() => {
    if (openIds.length === 0) return;

    function closeOutside(event) {
      if (!menuRef.current?.contains(event.target)) {
        setOpenIds([]);
      }
    }

    function closeOnNavigation() {
      setOpenIds([]);
    }

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    window.addEventListener("hashchange", closeOnNavigation);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      window.removeEventListener("hashchange", closeOnNavigation);
    };
  }, [openIds]);

  function closeSubmenuAndRestoreFocus() {
    const currentId = openIds.at(-1);
    if (currentId === undefined) return;
    triggerRefs.current[currentId]?.focus();
    setOpenIds([]);
  }

  function closeNavigation() {
    setOpenIds([]);
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape") return;

    if (openIds.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      closeSubmenuAndRestoreFocus();
    }
  }

  return (
    <nav
      ref={menuRef}
      className="menu"
      aria-label="Navegação principal"
      onKeyDown={handleKeyDown}
    >
      <ul className="menu__list">
        {renderItems(items)}
      </ul>
      <section
        className="menu__submenu-panel"
        id={`${menuPrefix}-submenu-panel`}
        aria-labelledby={submenuTitleId}
        hidden={!openItem}
      >
        {openItem && (
          <>
            <h2 id={submenuTitleId}>{openItem.label}</h2>
            <ul>{renderItems(openItem.children)}</ul>
          </>
        )}
      </section>
    </nav>
  );

  function renderItems(menuItems) {
    return menuItems.map((item) => (
          <li className="menu__item" key={item.routeId ?? item.id}>
            {item.children?.length ? (
              <>
                <button
                  ref={(node) => { triggerRefs.current[item.id] = node; }}
                  type="button"
                  className={`menu__link${item.id === activeModuleId || item.pageId === currentDestination?.id ? " menu__link--active" : ""}`}
                  aria-label={item.label}
                  title={item.label}
                  aria-expanded={openIds[0] === item.id}
                  aria-haspopup="true"
                  aria-controls={`${menuPrefix}-desktop-${item.id} ${menuPrefix}-submenu-panel`}
                  onClick={() => setOpenIds((current) => toggleMenuPath(current, [], item.id))}
                >
                  <MenuIcon name={item.icon} />
                  {item.label}
                </button>
                <ul
                  id={`${menuPrefix}-desktop-${item.id}`}
                  className="menu__submenu"
                  aria-label={item.label}
                  hidden={openIds[0] !== item.id}
                >
                  {renderItems(item.children)}
                </ul>
              </>
            ) : item.disabled ? (
              <button
                type="button"
                className="menu__link menu__link--disabled"
                aria-label={item.label}
                title={item.label}
                aria-disabled="true"
                disabled
              >
                <MenuIcon name={item.icon} />
                {item.label}
              </button>
            ) : (
              <a
                className="menu__link"
                aria-label={item.label}
                title={item.label}
                href={item.href}
                aria-current={(item.routeId ?? item.id) === activeRouteId || item.id === activeRouteId ? "page" : undefined}
                onClick={closeNavigation}
              >
                <MenuIcon name={item.icon} />
                {item.label}
              </a>
            )}
          </li>
        ));
  }
}
