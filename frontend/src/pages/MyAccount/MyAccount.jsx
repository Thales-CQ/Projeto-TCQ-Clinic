import "./MyAccount.css";

export default function MyAccount({ user }) {
  const profiles = Array.isArray(user?.profiles)
    ? user.profiles.map((profile) => profile.name).filter(Boolean)
    : [];

  return (
    <section className="my-account" aria-labelledby="my-account-title">
      <header className="my-account__intro">
        <h1 id="my-account-title">Meu perfil</h1>
        <p>Dados da sua conta no sistema.</p>
      </header>

      <dl className="my-account__details">
        <div>
          <dt>Nome completo</dt>
          <dd>{user?.full_name?.trim() || "Não informado"}</dd>
        </div>
        <div>
          <dt>Nome de usuário</dt>
          <dd>{user?.username || "Não informado"}</dd>
        </div>
        <div>
          <dt>Perfis de acesso</dt>
          <dd>{profiles.length > 0 ? profiles.join(", ") : "Nenhum perfil associado"}</dd>
        </div>
        <div>
          <dt>Acesso administrativo</dt>
          <dd>{user?.is_admin ? "Sim" : "Não"}</dd>
        </div>
      </dl>
    </section>
  );
}
