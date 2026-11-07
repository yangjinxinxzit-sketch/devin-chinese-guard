const acorn = require('acorn');
function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(x => walk(x, visit, node));
    else if (value && typeof value === 'object') walk(value, visit, node);
  }
}
const text = node => node?.type === 'Literal' ? node.value : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : undefined;
const name = node => node?.type === 'Identifier' ? node.name : text(node);
const prop = (object, key) => object?.type === 'ObjectExpression' ? object.properties.find(p => p.type === 'Property' && name(p.key) === key) : undefined;
const slots = string => (string.match(/\{\{[^{}]+\}\}|\{\d+\}|<\/?[a-zA-Z][^>]*>/g) || []).sort().join('\0');
const valid = (en, zh) => typeof zh === 'string' && !!zh && slots(en) === slots(zh);

function analyze(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const parents = new WeakMap();
  const inits = [], registries = [], definitions = new Map();
  walk(ast, (node, parent) => {
    if (parent) parents.set(node, parent);
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && name(node.callee.property) === 'init') {
      const options = node.arguments[0], resources = prop(options, 'resources');
      const namespaces = prop(options, 'ns')?.value;
      if (resources?.value.type === 'Identifier' && text(prop(options, 'fallbackLng')?.value) === 'en' && namespaces?.type === 'ArrayExpression' && namespaces.elements.some(x => text(x) === 'translation') && namespaces.elements.some(x => text(x) === 'review')) inits.push({ node, options, resources });
    }
    if (node.type === 'ArrayExpression' && node.elements.length >= 3) {
      const codes = node.elements.map(x => text(prop(x, 'code')?.value));
      if (codes.includes('en') && codes.includes('ja') && codes.includes('es') && node.elements.some(x => text(prop(x, 'label')?.value) === 'English')) registries.push(node);
    }
  });
  // Only inspect direct assignments inside module initializer closures. Nested
  // component-local variables are deliberately excluded; no bundle is executed.
  function collect(expression) {
    if (expression?.type === 'SequenceExpression') expression.expressions.forEach(collect);
    else if (expression?.type === 'AssignmentExpression' && expression.operator === '=' && expression.left.type === 'Identifier') definitions.set(expression.left.name, expression.right);
  }
  for (const item of ast.body) {
    if (item.type === 'VariableDeclaration') for (const d of item.declarations) if (d.id.type === 'Identifier' && d.init) definitions.set(d.id.name, d.init);
    if (item.type !== 'FunctionDeclaration') continue;
    const ret = item.body.body.find(x => x.type === 'ReturnStatement')?.argument;
    const assignment = ret?.type === 'CallExpression' ? ret.callee : null;
    if (assignment?.type !== 'AssignmentExpression' || assignment.left.name !== item.id.name || assignment.right.type !== 'CallExpression') continue;
    const init = assignment.right.arguments.find(x => x.type === 'ArrowFunctionExpression' || x.type === 'FunctionExpression');
    if (!init) continue;
    if (init.body.type === 'BlockStatement') {
      for (const statement of init.body.body) if (statement.type === 'ExpressionStatement') collect(statement.expression);
    } else collect(init.body);
  }
  const memo = new Map(), active = new Set();
  function evaluate(n) {
    if (!n) throw Error('Unsupported catalog reference');
    if (n.type === 'Literal') return n.value;
    if (n.type === 'TemplateLiteral') return n.quasis.map((q, i) => q.value.cooked + (n.expressions[i] ? String(evaluate(n.expressions[i])) : '')).join('');
    if (n.type === 'Identifier' && definitions.has(n.name)) {
      if (active.has(n.name)) throw Error('Cyclic catalog reference');
      if (!memo.has(n.name)) { active.add(n.name); memo.set(n.name, evaluate(definitions.get(n.name))); active.delete(n.name); }
      return memo.get(n.name);
    }
    if (n.type === 'ConditionalExpression') return evaluate(n.alternate);
    if (n.type === 'ArrayExpression') return n.elements.map(evaluate);
    if (n.type === 'ObjectExpression') {
      const out = {};
      for (const p of n.properties) {
        if (p.type !== 'Property' || p.kind !== 'init' || p.method || p.computed) throw Error('Unsupported dynamic catalog');
        Object.defineProperty(out, name(p.key), { value: evaluate(p.value), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'JSON' && n.arguments.length === 1) {
      if (n.callee.property.name === 'parse') return JSON.parse(evaluate(n.arguments[0]));
      if (n.callee.property.name === 'stringify') return JSON.stringify(evaluate(n.arguments[0]));
    }
    throw Error('Unsupported catalog expression: ' + n.type);
  }
  if (inits.length !== 1 || registries.length !== 1) throw Error('Frontend layout is not recognized unambiguously; no files changed');
  const init = inits[0], registry = registries[0];
  let owner = init.node;
  while (owner && !/Function/.test(owner.type)) owner = parents.get(owner);
  if (!owner) throw Error('Missing locale initialization scope');
  const declarations = [];
  walk(owner.body, node => { if (node.type === 'VariableDeclarator' && node.id.name === init.resources.value.name && prop(node.init, 'en')) declarations.push(node); });
  if (declarations.length !== 1) throw Error('Locale resources are not static');
  const en = prop(declarations[0].init, 'en').value;
  const english = { translation: evaluate(prop(en, 'translation')?.value), review: evaluate(prop(en, 'review')?.value) };
  let count = 0;
  walkValues(english, () => count++);
  if (count < 1000) throw Error('Incomplete English catalog; no files changed');
  return { english, resource: init.resources.value, registry, hasChinese: registry.elements.some(x => text(prop(x, 'code')?.value) === 'zh'), ast, strings: count };
}
function walkValues(value, callback, path = '') {
  if (typeof value === 'string') callback(value, path);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walkValues(item, callback, path ? path + '.' + key : key);
}
module.exports = { analyze, walk, walkValues, valid, slots };
