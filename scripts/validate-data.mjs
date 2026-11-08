// 저장된 Data Dragon 스냅샷(.cache/riot-data.json)에 대해 편집 데이터가 여전히 유효한지 검사한다.
// - 아이템 템플릿과 상황별 대안 ID가 현재 패치에 있고 소환사의 협곡에서 구매 가능한가
// - 의미 프로필 챔피언이 현재 카탈로그에 있고 이름이 같은가
// - 예제 카탈로그 아이템 이름이 현재 패치 이름과 같은가
// 사용: npm start로 스냅샷을 만든 뒤 npm run validate-data
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BUILD_TEMPLATES, SITUATIONAL_ITEMS, isPurchasable} from '../src/templates.js';
import {PROFILES} from '../src/ontology.js';
import {fallbackCatalog} from '../src/catalog.js';

export function validateEditorialData(catalog) {
  const problems = [],
    warnings = [];
  const templateIds = new Map();
  for (const [family, template] of Object.entries(BUILD_TEMPLATES))
    for (const id of [template.start, template.boots, ...template.core])
      templateIds.set(id, [...(templateIds.get(id) || []), family]);
  for (const id of SITUATIONAL_ITEMS) templateIds.set(id, [...(templateIds.get(id) || []), 'situational']);
  for (const [id, uses] of templateIds) {
    const item = catalog.items[id];
    if (!item) problems.push(`아이템 ${id}이(가) 현재 패치에 없습니다 (${uses.join(', ')})`);
    else if (!isPurchasable(item, null))
      problems.push(`아이템 ${id} ${item.name}을(를) 소환사의 협곡에서 구매할 수 없습니다 (${uses.join(', ')})`);
  }
  const champions = new Map(catalog.champions.map(champion => [champion.id, champion]));
  for (const profile of Object.values(PROFILES)) {
    const champion = champions.get(profile.id);
    if (!champion) problems.push(`의미 프로필 ${profile.id}이(가) 현재 카탈로그에 없습니다`);
    else if (champion.name !== profile.name)
      warnings.push(`프로필 이름 ${profile.id}: '${profile.name}' / 현재 '${champion.name}'`);
  }
  for (const item of Object.values(fallbackCatalog().items)) {
    const current = catalog.items[item.id];
    if (current && current.name !== item.name)
      warnings.push(`예제 아이템 이름 ${item.id}: '${item.name}' / 현재 '${current.name}'`);
  }
  return {problems, warnings, checkedItems: templateIds.size, checkedProfiles: Object.keys(PROFILES).length};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = resolve(import.meta.dirname, '..', '.cache', 'riot-data.json');
  let catalog;
  try {
    catalog = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    console.error('저장된 Data Dragon 스냅샷이 없습니다. 먼저 npm start로 서버를 실행하세요.');
    process.exit(2);
  }
  const {problems, warnings, checkedItems, checkedProfiles} = validateEditorialData(catalog);
  console.log(
    `Data Dragon champion ${catalog.championVersion} · item ${catalog.itemVersion} · 템플릿 아이템 ${checkedItems}개 · 프로필 ${checkedProfiles}명 검사`,
  );
  for (const warning of warnings) console.log(`경고  ${warning}`);
  for (const problem of problems) console.log(`문제  ${problem}`);
  if (problems.length) process.exit(1);
  console.log(warnings.length ? '구매 검증 통과 · 경고를 확인하세요' : '모두 통과');
}
