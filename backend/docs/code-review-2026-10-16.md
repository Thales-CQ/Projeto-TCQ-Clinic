# Revisão técnica das alterações pendentes

Data da revisão: 2026-10-16 (atualizado após aplicação em validação)
Escopo: alterações não staged em `backend/` e `frontend/`, arquivos novos, testes automatizados e fluxo de validação MySQL observado nesta conversa.
Modo: revisão, correção da collation/preflight e registro; `f3a4b5c6d7e8` foi aplicada pelo usuário somente em `clinica_validacao`.

## Resumo

- Suítes observadas nesta rodada antes da correção: backend `852 passed`; frontend Node `10 passed`; ESLint e build passaram. Após a correção da migração/preflight, o backend passou com `856 passed`. Nesta atualização do handler de erros, `tests/test_patients_api.py` passou com `130 passed`; `scripts/replace_validation_patients.py` passou em `py_compile`. ESLint/build não foram repetidos porque o frontend não mudou.
- O E2E real contra `clinica_validacao` passou: login, criação, leitura, edição e releitura do paciente `id=40`, prontuário `PR-000040`. O usuário confirmou que o registro também aparece na interface.
- A falha de cadastro foi localizada: collations diferentes em `patients.record_number` (`utf8mb4_0900_ai_ci`) e `patient_record_number_registry.record_number` (`utf8mb4_unicode_ci`). A segunda coluna foi alinhada manualmente na base `clinica_validacao`; ambas agora usam `utf8mb4_0900_ai_ci`.
- **Correção de código adicionada nesta etapa:** nova revisão `f3a4b5c6d7e8` alinha a collation do registro à coluna de pacientes; o launcher e o runner passam a verificar a igualdade. O runner agora compara o baseline real, permitindo preservar o paciente E2E adicional. O usuário aplicou essa revisão em `clinica_validacao`; o runner informou pós-verificação aprovada, 40 prontuários únicos e dados/IDs preservados. Não foi feita consulta à base de produção.
- O diretório de trabalho tem mudanças staged? Não. As alterações permanecem fora do stage, sem commit.

## Achados que precisam de decisão antes do commit

### P1 — A migração anterior recriou a incompatibilidade de collation

Em `migrations/versions/f1a2b3c4d5e6_add_patient_record_number.py`, a migração cria `patient_record_number_registry.record_number` como `sa.String(32)` sem especificar a collation. O MySQL herda o padrão do schema/tabela. Na base de validação, esse padrão ficou diferente do da coluna correspondente em `patients`; os triggers de reserva e consumo comparam essas colunas e o `INSERT` falhou com erro 1267.

**Evidência:** falha real do `POST /api/v1/patients` em 2026-10-16; comparação nos triggers `trg_patients_record_number_reserved` e `trg_patients_record_number_consume`; `SHOW FULL COLUMNS` mostrou as duas collations diferentes antes da correção manual.

**Estado atual:** `clinica_validacao` foi corrigida manualmente e o E2E passou depois. Em seguida, o usuário aplicou via Alembic a revisão `f3a4b5c6d7e8` a partir de `f2a3b4c5d6e7`; o runner aprovou a pós-verificação para 40 prontuários únicos e preservação de IDs/valores. Não foi feita consulta à base de produção nesta revisão.

### P2 — O preflight agora verifica a collation, mas requer a nova revisão

`run_validation_backend.py` compara as collations de `patients.record_number` e `patient_record_number_registry.record_number`; também exige a revisão `f3a4b5c6d7e8`. Após a migração, o usuário confirmou HTTP 200 em `/api/v1/health` tanto pela porta Flask 5001 quanto pelo proxy Vite 5174. Esses health checks confirmam conectividade; a saída de inicialização com revisão e contagens não foi incluída nesta confirmação.

**Estado:** implementado no código e coberto por testes unitários de igualdade/divergência. O usuário aplicou a revisão e confirmou health checks HTTP 200 depois; a saída de inicialização que mostraria explicitamente revisão/contagens não foi incluída, então o health check isolado não confirma esses detalhes do preflight.

### P2 — Erro SQL no cadastro agora tem resposta JSON estável

`app/routes/patients.py` trata erros `SQLAlchemyError`, faz rollback, registra a exceção no servidor e devolve HTTP 500 com JSON genérico (`code=database_error`). A resposta não inclui SQL nem detalhes internos.

**Verificação:** teste de API cobre `OperationalError` simulado, rollback, cabeçalho `Cache-Control: no-store` e ausência de SQL/detalhes internos no corpo.

## Código aparentemente morto

- O no-op que preservava `record_number` por meio de um bloco `if` vazio foi removido de `scripts/replace_validation_patients.py`; esse campo já não faz parte das colunas atualizadas.
- Os demais `pass` encontrados estão em caminhos de limpeza de exceção; não foram classificados como código morto.
- A busca textual não encontrou `TODO`, `FIXME`, `XXX` ou `NotImplemented` efetivos.
- Não há `ruff`, `pyflakes`, `vulture` ou `mypy` instalado no ambiente. Portanto, a revisão de código sem uso não equivale a uma análise estática Python completa. ESLint passou para o frontend.

## Arquivos e grupos de alterações

- **Pacientes/backend:** campos de endereço e validação; número de prontuário permanente; endpoints e serialização; novos testes de modelo, validação, busca, permissões e API.
- **CEP/backend e frontend:** configuração e consulta do provedor, proteção de credencial, permissões, interface de administração, preenchimento assistido no formulário e testes com provedores simulados.
- **Segurança de validação:** guard de identidade de banco, launcher Flask isolado, runner de migrations com confirmação, reset isolado do `ADMIN` e smoke test E2E.
- **Documentação:** `PRODUCT.md` fica fora do próximo commit, conforme decisão do usuário. `backend/docs/validation-environment.md` e este relatório são documentação operacional/revisão do trabalho.
- **Artefatos Impeccable:** `.impeccable/design.json` e `.impeccable/critique/*` ficam fora do commit; são artefatos de análise visual e não são necessários para executar backend ou frontend.

## Limites operacionais observados

- `scripts/replace_validation_patients.py` continua exigindo exatamente os IDs 1–39 como proteção do conjunto de dados previsto. O paciente E2E `id=40` faz o script recusar `--apply`, preservando-o contra substituição acidental. Não executar `--apply` na validação atual.
- A verificação HTTP feita pelo agente não alcançou `127.0.0.1:5001`/`5174` porque os serviços do usuário estão em outro ambiente de execução. Os logs fornecidos pelo usuário e a execução bem-sucedida do E2E documentam o fluxo real.
- Durante a migration, `log_bin_trust_function_creators` estava em `1`; o usuário executou `SET GLOBAL log_bin_trust_function_creators = 0` no monitor MySQL e confirmou `@@GLOBAL.log_bin=1` e `@@GLOBAL.log_bin_trust_function_creators=0`. Isso confirma o valor atual da instância; não foi verificada configuração persistente para reinicializações.

## Estado do Git

- Branch: `main`, acompanhando `origin/main`.
- O stage para este conjunto reúne alterações funcionais de backend/frontend, migrações, testes, scripts e documentação operacional/revisão.
- `PRODUCT.md` e `.impeccable/` foram excluídos da seleção.
- `git diff --check` e `git diff --cached --check` passaram antes do commit.

## Seleção para o próximo commit

- Manter `PRODUCT.md`, `.impeccable/design.json` e `.impeccable/critique/*` fora do commit.
- Considerar as alterações funcionais de backend/frontend, testes, migrações, scripts e documentação operacional/revisão, conferindo o diff integral antes do stage.
- A seleção staged para este conjunto exclui `PRODUCT.md` e `.impeccable`.

## Próximos passos recomendados

1. Confirmar com o DBA se `log_bin_trust_function_creators` foi restaurado para o valor original `0`.
2. Verificar somente leitura a revisão e a collation na base de produção antes de planejar qualquer migração nela.
3. Manter a proteção do script de substituição limitada aos IDs 1–39; ela impede que o paciente E2E `id=40` seja alterado.
4. O endpoint já devolve JSON estável para falhas SQL; os testes específicos passaram após a mudança.
5. Criar o commit com a seleção staged após a revisão final.
