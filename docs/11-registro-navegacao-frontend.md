# Registro da navegação e da interface responsiva

**Atualizado em:** 2026-11-02  
**Estado:** implementado no workspace; validação manual informada pelo usuário, com aceite por tela ainda não detalhado.

## Objetivo

Registrar as decisões e alterações feitas na navegação do TCQ Clinic, preservando
as rotas, permissões e operações existentes enquanto se organiza a experiência
em desktop e smartphone.

## Decisões e alterações

### Navegação principal e submenus

- Início, Pacientes e Configurações são as áreas principais atualmente expostas
  pela navegação. Configurações reúne Usuários, Perfis e Integração.
- A navegação mobile usa botões circulares somente com ícones e permite
  deslocamento horizontal sem barra de rolagem visível.
- Os submenus mobile aparecem abaixo do título da área selecionada; no desktop,
  os submenus permanecem em coluna.
- A abertura de submenu é controlada por estado único. Escape, clique fora e
  navegação fecham o submenu aberto.
- As cores de fundo do menu foram separadas das superfícies da aplicação:
  verde-azulado claro no tema claro e teal escuro no tema escuro.

### Conta e cabeçalho

- O antigo botão Sair foi substituído pelo botão Minha conta no mesmo conjunto
  de ações do cabeçalho.
- O submenu da conta oferece Meu perfil, Alterar senha e Sair.
- O cabeçalho mobile mostra nome e sobrenome do cadastro; a conta é representada
  por botão circular somente com ícone.
- O submenu da conta usa a mesma família, tamanho, peso e altura de linha dos
  submenus principais.

### Pacientes, Perfis e Usuários

- A navegação lateral redundante de Pacientes foi removida. Consultar e Cadastrar
  continuam disponíveis no submenu principal de Pacientes.
- O layout de Pacientes foi limitado a uma coluna depois da remoção da lateral,
  evitando que o conteúdo fique restrito à antiga coluna do menu.
- A navegação lateral de Perfis foi removida. A consulta continua pela opção
  Perfis em Configurações, e o cadastro é iniciado pelo botão Cadastrar perfil
  na lista, respeitando a permissão de criação.
- O formulário de Usuários em larguras intermediárias mantém no máximo duas
  colunas e largura limitada para evitar expansão excessiva.
- A troca de rota em Pacientes limpa edição e erro pendentes, preservando o
  comportamento que antes era acionado pelos links locais removidos.

### Integração

- As seções de opções da Integração iniciam recolhidas e podem ser expandidas
  individualmente.

## Áreas e arquivos envolvidos

- Navegação e rotas: `frontend/src/routes/navigation.js`,
  `frontend/src/components/Menu/`.
- Cabeçalho e conta: `frontend/src/components/Header/`,
  `frontend/src/components/HeaderAccountMenu/`,
  `frontend/src/components/ThemeToggle/` e `frontend/src/pages/MyAccount/`.
- Pacientes: `frontend/src/features/patients/`.
- Perfis: `frontend/src/features/profiles/`.
- Usuários: `frontend/src/features/users/styles/UserForm.css`.
- Integração: `frontend/src/features/settings/IntegrationFeature.jsx`.
- Tema: `frontend/src/styles/themes.css`.

## Verificações registradas

Após as alterações recentes, foram executados com sucesso:

- `npm run lint` em `frontend/`.
- `npm run build` em `frontend/`.
- Detector do Impeccable nos componentes alterados.
- `git diff --check`.

O usuário informou que fez teste manual no navegador. Os resultados por tela
(menu mobile, Pacientes, Perfis e Usuários) ainda não foram especificados; por
isso este registro não marca essas telas como aprovadas.

## Próximo passo

Registrar o resultado da validação manual por tela, corrigir eventuais problemas
e, com o fluxo de navegação aprovado, retomar o planejamento do próximo módulo.
