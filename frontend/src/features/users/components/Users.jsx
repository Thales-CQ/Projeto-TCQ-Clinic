import "../styles/Users.css";

export default function Users({ creating, editing, children }) {
  return (
    <section
      className={`module-shell users${creating ? " users--creating" : ""}${editing ? " users--editing" : ""}`}
      aria-labelledby="users-title"
    >
      <div className="users__content">
        {(creating || editing) && (
          <header className="users__header">
            <h2 id="users-title">{creating ? "Novo usuário" : "Editar usuário"}</h2>
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
