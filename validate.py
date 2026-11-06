
import sys, re, collections
p = sys.argv[1]
txt = open(p, encoding='utf-8-sig').read()
lines = txt.splitlines()
sec = None
sections = collections.OrderedDict()
errors, warns = [], []
rules = []
PREAMBLE_OK = {'ipv6','bypass-system','skip-proxy','bypass-tun','dns-server','update-url','#',''}
for i, ln in enumerate(lines, 1):
    s = ln.strip()
    if not s: continue
    if s.startswith('#') or s.startswith('//'): continue
    m = re.match(r'^\[(.+)\]$', s)
    if m:
        sec = m.group(1).strip()
        sections.setdefault(sec, 0)
        continue
    sections[sec] = sections.get(sec, 0) + 1
    if sec is None:
        errors.append(f'L{i} 段落外内容: {s[:60]}')
    elif sec == 'General':
        if '=' not in s: errors.append(f'L{i} General 缺 = : {s[:60]}')
    elif sec == 'Rule':
        if '//' in s: errors.append(f'L{i} 行内 // 注释: {s[:70]}')
        parts = [x.strip() for x in s.split(',')]
        if len(parts) < 3 and parts[0] != 'FINAL':
            errors.append(f'L{i} 规则字段不足: {s[:70]}')
        else:
            typ = parts[0]
            val = parts[1] if len(parts) > 1 else ''
            pol = parts[2] if len(parts) > 2 else ''
            if typ not in ('DOMAIN','DOMAIN-SUFFIX','DOMAIN-KEYWORD','IP-CIDR','IP-CIDR6','GEOIP','USER-AGENT','URL-REGEX','PROCESS-NAME','FINAL','RULE-SET','IP-ASN','HOST','DST-PORT','AND','OR','NOT'):
                warns.append(f'L{i} 未知规则类型 {typ}')
            if typ == 'FINAL' and len(parts) != 2:
                errors.append(f'L{i} FINAL 应为 FINAL,策略: {s[:70]}')
            if pol and pol not in ('PROXY','DIRECT','REJECT','REJECT-DROP','REJECT-TINYGIF','REJECT-NO-DROP') and not pol.startswith('PROXY'):
                pass
            if typ != 'FINAL' and not pol:
                errors.append(f'L{i} 缺策略: {s[:70]}')
            if typ.startswith('IP-CIDR') and not re.match(r'^[0-9a-fA-F:.]+/\d+$', val):
                errors.append(f'L{i} IP-CIDR 格式: {val}')
            rules.append((i, typ, val, pol))
    elif sec == 'URL Rewrite':
        if re.search(r'(^|\s)[\'"]', s): errors.append(f'L{i} 含引号: {s[:70]}')
        if not re.match(r'^\S+\s+\S+\s+(30[1278]|reject|reject-200|reject-img|reject-dict|reject-array|header)$', s):
            warns.append(f'L{i} 重写行格式待确认: {s[:70]}')
    elif sec == 'Script':
        if '=' not in s:
            errors.append(f'L{i} 脚本行缺 = : {s[:60]}')
        else:
            name, _, cfg = s.partition('=')
            kv = {}
            for part in cfg.split(','):
                if '=' in part:
                    k, _, v = part.strip().partition('=')
                    kv[k.strip()] = v.strip()
            if 'type' not in kv: warns.append(f'L{i} {name.strip()} 缺 type')
            if kv.get('type') == 'http-response' and 'requires-body' not in kv:
                warns.append(f'L{i} {name.strip()} http-response 缺 requires-body')
            if 'pattern' not in kv: warnes = None; errors.append(f'L{i} {name.strip()} 缺 pattern')
            if 'script-path' not in kv: errors.append(f'L{i} {name.strip()} 缺 script-path')
            sp = kv.get('script-path', '')
            if sp.startswith('http'):
                pass
            elif sp and not sp.startswith('local/'):
                warns.append(f'L{i} {name.strip()} script-path 非常规: {sp}')
    elif sec == 'MITM':
        if not (s.startswith('hostname') or s.startswith('h2') or s.startswith('skip-server-cert-verify')):
            warns.append(f'L{i} MITM 未知键: {s[:60]}')

# 策略值统计
pols = collections.Counter(r[3] for r in rules if r[3])
types = collections.Counter(r[1] for r in rules)
dups = [k for k, v in collections.Counter((r[1], r[2]) for r in rules).items() if v > 1]
# FINAL 位置
finals = [r[0] for r in rules if r[1] == 'FINAL']
after = [r[0] for r in rules if finals and r[0] > finals[0]]

print('段落:', dict(sections))
print('规则类型:', dict(types))
print('策略值:', dict(pols))
print('重复规则:', len(dups), dups[:5])
print('FINAL 之后还有规则:', after)
print('CRLF:', txt.count('\r\n'), '裸LF:', txt.count('\n') - txt.count('\r\n'))
print('BOM:', txt.startswith('\ufeff'))
print('错误:', len(errors))
for e in errors: print('  ERR ', e)
print('警告:', len(warns))
for w in warns: print('  WARN', w)
sys.exit(1 if errors else 0)
