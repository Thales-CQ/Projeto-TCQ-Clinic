import "../styles/Profiles.css";

export default function Profiles({
  creating, editing, children,
}) {
  return <section className="module-shell profiles" aria-labelledby="profiles-title">
    <div className={`profiles__content${creating || editing ? " profiles__content--creating" : " profiles__content--listing"}`}>
      {(creating || editing) && <h2 id="profiles-title">{editing ? "Editar perfil" : "Novo perfil"}</h2>}
      {children}
    </div>
  </section>;
}
