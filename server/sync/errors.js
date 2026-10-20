function category(error) {
  if(error.category) return error.category;
  if(error.status===401 || error.status===400 && /authorization/i.test(error.message || '')) return 'authorization';
  if(error.status===403) return 'permission';
  if(error.code==='ENOSPC') return 'disk-space';
  if(error.retryable===true || ['TimeoutError','AbortError','TypeError'].includes(error.name) || /^(E(CONN|NET|HOST|TIMEDOUT)|UND_ERR)/.test(error.code || '')) return 'network';
  if(/credential|keychain|passphrase|user canceled/i.test(error.message || '')) return 'credentials';
  if(/changed|busy|progress|preview cleanup/i.test(error.message || '')) return 'changed';
  if(/size|large|limit|history exceeds/i.test(error.message || '')) return 'size';
  if(/checksum|schema|snapshot|graph|collision|identity|version|corrupt/i.test(error.message || '')) return 'data';
  return 'operation';
}
function retryable(error) {
  if(typeof error.retryable==='boolean') return error.retryable;
  return category(error)==='network';
}
function publicError(error) {
  const code=category(error);
  // The original exception can contain private filesystem paths or provider data.
  const safe={authorization:'Google authorization expired; reconnect Google',permission:'Google access was denied; check account access',
    quota:'Google storage quota exceeded', 'disk-space':'Local disk space is insufficient',network:'Network request failed; retry later',
    credentials:'System credential storage requires attention',changed:'State changed or another task is running; check again',
    size:'Current preview size limit reached; review history cleanup or project size',data:'Version data failed validation; local work was preserved',operation:'Operation could not be completed; review the current state'};
  return {code,message:safe[code] || safe.operation,recoverable:true};
}
module.exports={category,retryable,publicError};
