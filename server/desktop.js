// The packaged executable supports an isolated native-credential diagnostic.
if (process.argv.includes('--check-credentials')) {
  const { randomUUID } = require('node:crypto');
  const { SecureVault } = require('./sync/vault');
  const vault = new SecureVault(`smoke.${randomUUID()}`, require('node:os').tmpdir());
  (async () => {
    try {
      await vault.set({access_token:'synthetic-desktop-check',refresh_token:'synthetic-desktop-check'});
      const saved = await vault.get();
      if (saved?.access_token !== 'synthetic-desktop-check') throw new Error('Credential roundtrip failed');
    } finally { await vault.clear(); }
    console.log('Desktop credential store check passed');
  })().then(() => process.exit(0)).catch(error => {console.error(error.message);process.exit(1);});
} else {
  require('./sync/system-proxy').adoptSystemProxy();
  require('./index');
}
