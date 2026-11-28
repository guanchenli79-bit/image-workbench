import rules from '../src/model-rules.cjs';

const {emptyManifest, normalizeRuleSet, validateManifest} = rules;
const query = 'SELECT revision, config_json, published_at, rollback_of FROM model_rule_revisions';

function asManifest(row) {
  if(!row)return emptyManifest();
  return validateManifest({revision:Number(row.revision),publishedAt:row.published_at,rollbackOf:row.rollback_of,
    config:JSON.parse(row.config_json)});
}

export async function currentRules(db) {
  return asManifest(await db.prepare(query+' ORDER BY revision DESC LIMIT 1').first());
}
export async function ruleHistory(db) {
  const {results}=await db.prepare('SELECT revision, published_at AS publishedAt, rollback_of AS rollbackOf FROM model_rule_revisions ORDER BY revision DESC LIMIT 30').all();
  return results||[];
}
export async function publishRules(db, input, rollback=false) {
  const expectedRevision=input?.expectedRevision;
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Object.assign(new Error('请先刷新接口规则'),{status:400});
  let config;
  let rollbackOf=null;
  if(rollback){
    rollbackOf=input?.targetRevision;
    if(!Number.isSafeInteger(rollbackOf)||rollbackOf<0||rollbackOf>=expectedRevision)
      throw Object.assign(new Error('请选择更早的规则版本'),{status:400});
    if(rollbackOf===0)config=emptyManifest().config;
    else{
      const chosen=await db.prepare(query+' WHERE revision=?').bind(rollbackOf).first();
      if(!chosen)throw Object.assign(new Error('找不到要回退的版本'),{status:404});
      config=asManifest(chosen).config;
    }
  }else{
    try{config=normalizeRuleSet(input?.config);}
    catch(error){throw Object.assign(error,{status:400});}
  }

  const row=await db.prepare(
    'INSERT INTO model_rule_revisions(config_json,published_at,rollback_of) '+
    'SELECT ?,?,? WHERE COALESCE((SELECT MAX(revision) FROM model_rule_revisions),0)=? '+
    'RETURNING revision, config_json, published_at, rollback_of'
  ).bind(JSON.stringify(config),new Date().toISOString(),rollbackOf,expectedRevision).first();
  if(!row)throw Object.assign(new Error('其他操作已发布新版本，请刷新后再提交'),{status:409});
  return asManifest(row);
}
