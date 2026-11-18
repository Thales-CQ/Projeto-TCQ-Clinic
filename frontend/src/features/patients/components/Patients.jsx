import "../styles/Patients.css";

export default function Patients({
  creating,
  editing,
  children,
}) {
  return (
    <section className={`module-shell patients${creating ? " patients--creating" : ""}${editing ? " patients--editing" : ""}`} aria-labelledby="patients-title">
      <div className="patients__content">
        {(creating || editing) && (
          <header className="patients__header">
            <h2 id="patients-title">{creating ? "Novo paciente" : "Editar paciente"}</h2>
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
