import machineIdModule from 'node-machine-id';

const { machineIdSync } = machineIdModule;

function normalizeMachineId(value) {
  return String(value ?? '').trim();
}

/**
 * Machine ID local.
 * Em dev (`POS_DEV_TENANT` / `POS_ALLOW_MACHINE_ID_OVERRIDE`) pode usar
 * `POS_MACHINE_ID` estável por pasta `.dev-tenants/<id>/` para não colidir
 * com o app instalado (%APPDATA%\POSly + ID real do hardware).
 */
export function getLocalMachineId() {
  const override = normalizeMachineId(
    process.env.POS_MACHINE_ID || process.env.POS_DEV_MACHINE_ID,
  );
  if (!override) {
    return machineIdSync({ original: true });
  }

  const allowOverride = ['1', 'true', 'yes', 'y'].includes(
    String(process.env.POS_ALLOW_MACHINE_ID_OVERRIDE ?? '')
      .trim()
      .toLowerCase(),
  );
  const isDevTenant = Boolean(normalizeMachineId(process.env.POS_DEV_TENANT));
  if (allowOverride || isDevTenant) {
    return override;
  }

  return machineIdSync({ original: true });
}
