const REQUIRED_DATABASE_VARIABLES = [
  'DATABASE_HOST',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
] as const;

export function validateEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const validatedEnvironment = { ...environment };

  const databaseType = environment.DATABASE_TYPE ?? 'postgres';
  if (databaseType !== 'postgres') {
    throw new Error('DATABASE_TYPE must be "postgres"');
  }
  validatedEnvironment.DATABASE_TYPE = databaseType;

  for (const variable of REQUIRED_DATABASE_VARIABLES) {
    const value = environment[variable];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${variable} is required`);
    }
  }

  const databasePort = Number(environment.DATABASE_PORT ?? 5432);
  if (
    !Number.isInteger(databasePort) ||
    databasePort < 1 ||
    databasePort > 65535
  ) {
    throw new Error('DATABASE_PORT must be an integer between 1 and 65535');
  }
  validatedEnvironment.DATABASE_PORT = databasePort.toString();

  return validatedEnvironment;
}
