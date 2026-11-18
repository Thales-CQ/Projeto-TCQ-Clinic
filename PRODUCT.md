# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Gestores e equipes administrativas de clínicas, além de profissionais de saúde e equipes clínicas. O sistema deve apoiar a organização da operação clínica, o atendimento e os cadastros no uso cotidiano.

## Product Purpose

Sistema web para gerenciamento de informações clínicas. O sucesso significa organizar a operação clínica e simplificar o atendimento e os cadastros.

## Positioning

Diferencial de posicionamento ainda em aberto. Não inventar uma alegação de diferenciação.

## Operating Context

O produto é uma aplicação web com interface responsiva para uso em smartphones, tablets e desktops. Os fluxos atuais incluem autenticação, cadastro, consulta, pesquisa e edição de pacientes, além de gestão de usuários, perfis e permissões. Funcionalidades clínicas adicionais estão descritas como futuras no roadmap.

## Capabilities and Constraints

- Interface em React e Vite; API REST em Python e Flask; MySQL como banco de dados, conforme a documentação do projeto.
- Privacidade e segurança dos dados clínicos são requisitos obrigatórios. Autenticação, autorização, validação e regras de negócio devem ser aplicadas no backend; controles de interface não substituem autorização no servidor.
- A interface deve oferecer português do Brasil, acessibilidade, responsividade para smartphone, tablet e desktop, e temas claro e escuro.
- Manter responsabilidades separadas entre interface, regras de negócio e persistência. Código deve ser limpo, organizado, reutilizável e escalável.
- Manter a implementação do produto separada da documentação e das decisões de design; centralizar tokens visuais e evitar estilos inline, conforme os princípios de arquitetura registrados no projeto.
- A implantação e o ambiente operacional de produção ainda não foram confirmados.

## Brand Commitments

- Idioma da interface: português do Brasil.

## Evidence on Hand

- Documentação de visão geral, requisitos, segurança e roadmap no diretório `docs/`.
- Implementação existente do frontend, backend e testes automatizados no repositório.
- Não foram identificados no projeto depoimentos, métricas de resultado ou provas comerciais. Não criar esses materiais como se fossem reais.

## Product Principles

- Proteger a privacidade e a segurança das informações clínicas.
- Fazer cumprir permissões e regras de negócio no backend.
- Simplificar as tarefas cotidianas de atendimento e administração clínica.
- Manter a aplicação acessível e funcional em diferentes dispositivos e temas.
- Preservar código organizado, reutilizável e separado por responsabilidade.
