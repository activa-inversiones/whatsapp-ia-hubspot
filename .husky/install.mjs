// Instala los hooks de husky en desarrollo. En produccion/CI (Railway sin devDependencies) no hace nada
// y NUNCA falla: un `npm install` de despliegue no puede romperse por un hook local (#1058).
if (process.env.NODE_ENV === 'production' || process.env.CI === 'true') process.exit(0);
try {
  const husky = (await import('husky')).default;
  const out = husky();
  if (out) console.log(out);
} catch {
  // husky no instalado (npm install --omit=dev): se ignora a proposito.
}
