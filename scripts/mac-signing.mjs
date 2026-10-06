import { execFileSync } from 'node:child_process';
import { readdirSync, lstatSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
export function signingConfig(env = process.env) {
  const identity = env.STOCKNEWS_SIGN_IDENTITY?.trim();
  const profile = env.STOCKNEWS_NOTARY_PROFILE?.trim();
  if (!identity || !profile) throw new Error('正式分发需要 STOCKNEWS_SIGN_IDENTITY（Developer ID Application 证书名称或 SHA-1）和 STOCKNEWS_NOTARY_PROFILE（钥匙串中的公证配置名称）。不会退回临时签名。');
  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  if (!identities.split('\n').some(line => line.includes('Developer ID Application:') && (line.includes(`"${identity}"`) || line.toUpperCase().includes(` ${identity.toUpperCase()} `)))) {
    throw new Error('钥匙串中没有指定的有效 Developer ID Application 证书及私钥。请先在本机配置，勿把私钥或密码提交到项目。');
  }
  run('xcrun', ['--find', 'notarytool']);
  run('xcrun', ['--find', 'stapler']);
  return { identity, profile };
}

// Sign all nested Mach-O files first, then seal the application. Do not use --deep to sign.
export function signApp(bundle, config, outputDirectory) {
  const entitlementFile = path.join(outputDirectory, 'node-entitlements.plist');
  writeFileSync(entitlementFile, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/></dict></plist>`);
  const visit = directory => {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { visit(file); continue; }
      if (!stat.isFile()) continue;
      const fd = openSync(file, 'r');
      const header = Buffer.alloc(4);
      try { readSync(fd, header, 0, 4, 0); } finally { closeSync(fd); }
      if (!['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'))) continue;
      const args = ['--force', '--sign', config.identity, '--timestamp', '--options', 'runtime'];
      if (file === path.join(bundle, 'Contents/Resources/runtime/node')) args.push('--entitlements', entitlementFile);
      run('codesign', [...args, file]);
    }
  };
  visit(path.join(bundle, 'Contents'));
  run('codesign', ['--force', '--sign', config.identity, '--timestamp', '--options', 'runtime', bundle]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
}

export function notarize(file, config, outputDirectory, label) {
  // Secrets remain in Keychain. Persist the submission ID even for rejected submissions.
  const response = execFileSync('xcrun', ['notarytool', 'submit', file, '--keychain-profile', config.profile, '--wait', '--timeout', '20m', '--output-format', 'json'], { encoding: 'utf8', timeout: 21 * 60 * 1000 });
  writeFileSync(path.join(outputDirectory, `${label}-notary.json`), response);
  const result = JSON.parse(response);
  if (result.status !== 'Accepted') {
    if (result.id) run('xcrun', ['notarytool', 'log', result.id, '--keychain-profile', config.profile, path.join(outputDirectory, `${label}-notary-log.json`)]);
    throw new Error(`Apple 公证未通过（${result.status || '未知状态'}）。不生成正式交付标记，请检查公证日志。`);
  }
}

export function notarizeApp(bundle, config, outputDirectory) {
  const zip = path.join(outputDirectory, 'Stocknews-notary.zip');
  run('ditto', ['-c', '-k', '--keepParent', bundle, zip]);
  notarize(zip, config, outputDirectory, 'app');
  run('xcrun', ['stapler', 'staple', bundle]);
  run('xcrun', ['stapler', 'validate', bundle]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle]);
}

export function notarizeDmg(dmg, config, outputDirectory) {
  run('codesign', ['--force', '--sign', config.identity, '--timestamp', dmg]);
  notarize(dmg, config, outputDirectory, 'dmg');
  run('xcrun', ['stapler', 'staple', dmg]);
  run('xcrun', ['stapler', 'validate', dmg]);
  run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
}
