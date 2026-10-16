# Ambiente de validação TCQ Clinic

Este procedimento usa somente `clinica_validacao` e a conta `clinica_teste@localhost`.
O backend de validação não carrega `backend/.env`, gera uma chave de sessão efêmera
para o processo e recusa iniciar se banco, usuário, versão, revisão, colunas,
sequência, registry, prontuários, usuários ou triggers não corresponderem ao perfil
esperado.

## Estado atual

O MySQL de validação foi identificado como 8.0.46. A base tinha 39 pacientes antes
do E2E; o paciente sintético `PR-000040` foi criado depois e permanece em validação.
A revisão `f3a4b5c6d7e8` foi aplicada em `clinica_validacao`; o runner aprovou a
pós-verificação com 40 prontuários únicos e preservação de IDs e valores originais.
O usuário também confirmou HTTP 200 no health check do Flask (5001) e pelo proxy
Vite (5174). Durante a aplicação, `log_bin=1` e
`log_bin_trust_function_creators=1`; o valor original observado antes da janela era
`0`. Após a migration, o usuário executou `SET GLOBAL log_bin_trust_function_creators = 0`
no monitor MySQL e confirmou `@@GLOBAL.log_bin=1` e
`@@GLOBAL.log_bin_trust_function_creators=0`. Isso confirma o valor na instância em
execução; a configuração persistente após reinicialização não foi verificada.

## Janela de migrations

Este bloco documenta o procedimento executado na janela de validação e serve como
referência para futuras migrations que criem triggers. O valor original observado
foi `0`. Como a variável é GLOBAL, o DBA deve coordenar a janela e verificar que não
há outras criações de funções ou triggers no servidor.

1. Antes da execução, confirmar `DATABASE()`, `CURRENT_USER()`, a revisão, o
   baseline atual de pacientes (mínimo de 39, preservado integralmente) e quatro
   usuários, além de `@@GLOBAL.log_bin=1` /
   `@@GLOBAL.log_bin_trust_function_creators=0`.
2. Em sessão administrativa, habilitar temporariamente e confirmar:

   ```sql
   SET GLOBAL log_bin_trust_function_creators = 1;
   SELECT @@GLOBAL.log_bin, @@GLOBAL.log_bin_trust_function_creators;
   ```

3. No backend:

   ```bash
   cd /home/administrator/clinica/backend
   .venv/bin/python scripts/run_validated_mysql_migrations.py --apply
   ```

   O runner pede a senha sem colocá-la na linha de comando, exige confirmação
   literal `MIGRAR clinica_validacao`, verifica o destino e interrompe antes de
   DDL se o erro 1419 for previsível. `upgrade head` aplica as revisões pendentes,
   incluindo `f3a4b5c6d7e8`, que alinha `patient_record_number_registry.record_number`
   à collation de `patients.record_number`. Essa revisão já foi aplicada na
   validação em 2026-10-16. O runner compara todos os pacientes
   presentes, usuários e associações usuário–perfil/perfil–permissão com o
   baseline capturado; não exige que a validação continue com exatamente 39
   pacientes após os testes E2E.

4. Assim que o runner terminar, inclusive se falhar, o DBA restaura e confirma o
   valor original:

   ```sql
   SET GLOBAL log_bin_trust_function_creators = 0;
   SELECT @@GLOBAL.log_bin, @@GLOBAL.log_bin_trust_function_creators;
   ```

   Se a conexão cair, reconectar e restaurar `0` imediatamente. Não conceder
   privilégios globais à conta da aplicação.

## Inicializar o backend

Depois de `f3a4b5c6d7e8` estar aplicada e as verificações do runner passarem:

```bash
cd /home/administrator/clinica/backend
TCQ_VALIDATION_PORT=5001 .venv/bin/python scripts/run_validation_backend.py
```

Digite a senha de `clinica_teste` no prompt. O servidor valida o schema antes de
iniciar, fica somente em `127.0.0.1:5001` e verifica `DATABASE()` e `CURRENT_USER()`
antes de cada comando SQL. As sessões usam uma chave temporária e não reaproveitam
credenciais de produção.

Em outro terminal:

```bash
cd /home/administrator/clinica/frontend
TCQ_API_PROXY_TARGET=http://127.0.0.1:5001 npm run dev -- --host 0.0.0.0 --port 5174
```

O frontend chama `/api/v1`; `TCQ_API_PROXY_TARGET` encaminha `/api` para o backend
de validação. Sem essa variável, o proxy mantém o destino padrão
`http://127.0.0.1:5000`.

## Teste real pelo proxy

Os testes unitários Node atuais validam payloads, cookies e CSRF com `fetch`
simulado. Para provar o fluxo HTTP real pelo Vite até a API e o MySQL, iniciar os
dois servidores acima e, após autorização explícita para criar um novo registro
fictício permanente:

```bash
cd /home/administrator/clinica/backend
.venv/bin/python scripts/validation_e2e_smoke.py --write \
  --base-url http://127.0.0.1:5174
```

O smoke test pede confirmação `E2E clinica_validacao` e credenciais de uma conta
com permissões de consulta, cadastro e edição de pacientes. Ele cria um paciente
identificado como teste fictício, consulta, edita o endereço e confirma a
persistência pela releitura via Vite. O registro fica no banco e consome um número
de prontuário, pois o histórico de prontuários é permanente; o script não apaga
nem substitui pacientes.

Os testes backend existentes usam SQLite temporário. Eles cobrem sessão, CSRF,
permissões, rotas de usuários/perfis, validação e pacientes; os testes CEP usam
provedores simulados e não exigem rede externa.
