import {PROFILES, ROLES, ROLE_NAMES, TRAITS} from './ontology.js';
import {BUILD_TEMPLATES, fallbackBuildFamily} from './engine.js';

const keyOf = node => `${node.type}:${node.id}`;

export function createOntology(catalog) {
  const nodes = new Map();
  const edges = [];
  const championVersion=catalog.championVersion||catalog.version,itemVersion=catalog.itemVersion||catalog.version;
  const addNode = node => { nodes.set(keyOf(node), node); return node; };
  const addEdge = (from, type, to, evidence = {}) => edges.push({from, type, to, ...evidence});

  for (const role of ROLES) addNode({type:'Role', id:role, name:ROLE_NAMES[role], source:'application-vocabulary'});
  for (const [id, name] of Object.entries(TRAITS)) addNode({type:'Trait', id, name, source:'editorial-vocabulary'});
  if (championVersion) addNode({type:'Patch', id:championVersion, name:`챔피언 ${championVersion}`, version:championVersion, source:'Riot Data Dragon'});
  if (itemVersion&&itemVersion!==championVersion) addNode({type:'Patch', id:itemVersion, name:`아이템 ${itemVersion}`, version:itemVersion, source:'Riot Data Dragon'});

  for (const champion of catalog.champions) {
    const profile = PROFILES[champion.id];
    const node = addNode({
      type:'Champion', ...champion, version:championVersion,
      source:catalog.mode === 'official' ? 'Riot Data Dragon' : 'demo catalog',
      annotationSource:profile?.source || 'none',
      reviewStatus:profile?.reviewStatus || 'unreviewed',
      editorialRoles:profile?.roles || [], editorialDamage:profile?.damage || 'unknown',
      editorialBuild:profile?.build || '', editorialTraits:profile?.traits || [],
    });
    if (championVersion) addEdge(keyOf(node), 'AVAILABLE_IN', `Patch:${championVersion}`, {source:'Riot Data Dragon',version:championVersion});
    for (const ability of catalog.abilities?.[champion.id] || champion.abilities || []) {
      const abilityNode=addNode({type:'Ability', ...ability, championId:champion.id, championName:champion.name, version:catalog.abilitiesVersion||championVersion, source:'Riot Data Dragon'});
      addEdge(keyOf(node), 'HAS_ABILITY', keyOf(abilityNode), {source:'Riot Data Dragon',version:catalog.abilitiesVersion||championVersion,slot:ability.slot,patchValidated:true});
    }
    for (const role of profile?.roles || []) addEdge(keyOf(node), 'PLAYS_ROLE', `Role:${role}`, {source:profile.source, reviewStatus:profile.reviewStatus});
    for (const trait of profile?.traits || []) addEdge(keyOf(node), 'HAS_TRAIT', `Trait:${trait}`, {source:profile.source, reviewStatus:profile.reviewStatus});

    for (const role of profile?.roles?.length ? profile.roles : ROLES) {
      const family = role === 'SUPPORT' && profile?.build === 'tank' ? 'supporttank' : profile?.build || fallbackBuildFamily(champion,role);
      const template = BUILD_TEMPLATES[family];
      if (!template) continue;
      const candidates = [['start', template.start], ['boots', template.boots], ...template.core.map((id, index) => [`core-${index+1}`, id])];
      for (const [slot, itemId] of candidates) {
        if (catalog.items[itemId]) addEdge(keyOf(node), 'HAS_BUILD_CANDIDATE', `Item:${itemId}`, {
          role, slot, family, source:'editorial-item-template-v0', reviewStatus:'prototype', patchValidated:false,
        });
      }
    }
  }

  for (const item of Object.values(catalog.items)) {
    const node = addNode({type:'Item', ...item, version:itemVersion, source:catalog.mode === 'official' ? 'Riot Data Dragon' : 'demo catalog'});
    if (itemVersion) addEdge(keyOf(node), 'AVAILABLE_IN', `Patch:${itemVersion}`, {source:'Riot Data Dragon',version:itemVersion});
    for (const componentId of item.from || []) {
      if (catalog.items[componentId]) addEdge(keyOf(node), 'BUILDS_FROM', `Item:${componentId}`, {source:'Riot Data Dragon', version:itemVersion});
    }
  }

  return {nodes, edges, version:championVersion||null, versions:[...new Set([championVersion,itemVersion].filter(Boolean))], source:catalog.mode === 'official' ? 'Riot Data Dragon' : 'demo catalog'};
}

function edgeTargets(graph, node) {
  return graph.edges.filter(edge => edge.from === keyOf(node) || edge.to === keyOf(node)).map(edge => {
    const incoming = edge.to === keyOf(node);
    const target = graph.nodes.get(incoming ? edge.from : edge.to);
    return target ? {relationship:edge.type, direction:incoming?'incoming':'outgoing', targetType:target.type, targetId:target.id, targetName:target.name, source:edge.source, reviewStatus:edge.reviewStatus, role:edge.role, slot:edge.slot, patchValidated:edge.patchValidated} : null;
  }).filter(Boolean);
}

export function ontologyNeighborhood(graph, type, id, filters = {}) {
  const allowedTypes = new Set(['Champion','Item','Role','Trait','Patch','Ability']);
  if (!allowedTypes.has(type) || typeof id !== 'string') return null;
  const entity = graph.nodes.get(`${type}:${id}`);
  if (!entity || (filters.patch && (!graph.versions.includes(filters.patch)||(entity.version&&entity.version!==filters.patch)))) return null;
  const {role = '', relationship = ''} = filters;
  if (role && !ROLES.includes(role)) throw new Error('Unsupported ontology role');
  const allowedRelationships = new Set(['AVAILABLE_IN','PLAYS_ROLE','HAS_TRAIT','BUILDS_FROM','HAS_BUILD_CANDIDATE','HAS_ABILITY']);
  if (relationship && !allowedRelationships.has(relationship)) throw new Error('Unsupported ontology relationship');
  const relations = edgeTargets(graph, entity)
    .filter(edge => (!role || edge.role === role || edge.targetType === 'Role' && edge.targetId === role || entity.type === 'Role' && entity.id === role))
    .filter(edge => !relationship || edge.relationship === relationship);
  return {entity, relations};
}

export function searchOntology(graph, type, query = '', patch = '', limit = 30, filters = {}) {
  if (!['champion','item'].includes(type)) throw new Error('Unsupported ontology type');
  const {role = '', relationship = ''} = filters || {};
  if (role && !ROLES.includes(role)) throw new Error('Unsupported ontology role');
  const allowedRelationships = new Set(['AVAILABLE_IN','PLAYS_ROLE','HAS_TRAIT','BUILDS_FROM','HAS_BUILD_CANDIDATE','HAS_ABILITY']);
  if (relationship && !allowedRelationships.has(relationship)) throw new Error('Unsupported ontology relationship');
  if (patch && !graph.versions.includes(patch)) return [];
  const nodeType = type === 'champion' ? 'Champion' : 'Item';
  const needle = query.trim().toLocaleLowerCase();
  return [...graph.nodes.values()]
    .filter(node => node.type === nodeType && (!patch||node.version===patch) && (!needle || `${node.id} ${node.name || ''} ${node.title || ''} ${node.plaintext || ''}`.toLocaleLowerCase().includes(needle)))
    .map(entity => ({entity, relations:edgeTargets(graph, entity)}))
    .filter(({relations}) => (!role || relations.some(edge => edge.targetType === 'Role' && edge.targetId === role || edge.role === role))
      && (!relationship || relations.some(edge => edge.relationship === relationship)))
    .sort((a,b) => String(a.entity.name || a.entity.id).localeCompare(String(b.entity.name || b.entity.id),'ko'))
    .slice(0, Math.max(1, Math.min(40, limit)))
    .map(result => ({...result, relations:relationship ? result.relations.filter(edge => edge.relationship === relationship) : result.relations}));
}

export function itemBuildCandidates(graph, championId, role) {
  const node = graph.nodes.get(`Champion:${championId}`);
  if (!node || !ROLES.includes(role)) return [];
  const order = {start:0, boots:1, 'core-1':2, 'core-2':3, 'core-3':4, 'core-4':5, 'core-5':6, 'core-6':7};
  return graph.edges.filter(edge => edge.from === keyOf(node) && edge.type === 'HAS_BUILD_CANDIDATE' && edge.role === role)
    .map(edge => ({...edge, item:graph.nodes.get(edge.to)}))
    .filter(edge => edge.item)
    .sort((a,b) => (order[a.slot] ?? 99) - (order[b.slot] ?? 99));
}
