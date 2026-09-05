# Registro de aprobaciones humanas

Un archivo congelado en `../policy/GOVERNANCE.lock.yml` solo se descongela con un
registro aquí. **El agente nunca se auto-aprueba** (§14.5).

Un fichero por aprobación, con nombre `AAAA-MM-DD-<slug>.yml`:

```yaml
approved_by: roberto-cuellar
approved_at: "2026-09-05T14:22:00Z"
file: governance/policy/task-policy.yml
old_sha256: "fe0d90b0..."
new_sha256: "013f16f3..."
reason: "Subir maximumActiveIssues a 2 tras medir que el lease único bloqueaba X"
evidence: "attempts.jsonl att_0142, att_0147"
```

El flujo, y no hay otro:

1. El agente propone el diff **sin aplicarlo**.
2. El humano crea el fichero de aprobación.
3. Se actualiza el `sha256` en el lock.
4. `verify.mjs` vuelve a cuadrar.

Un hash que no cuadra sin aprobación correspondiente **aborta la consolidación**.
