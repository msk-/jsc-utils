
// TODO:
// - A "partial match" functionality for astNodesAreEquivalent would be excellent. Such that we could
//   say something like:
//     astNodesAreEquivalent(path, jsc.callExpression(jsc.identifier('foo'), jscUtils.ANY))
//   and that would identify a call to function `foo` with any parameters at all.
//   Or:
//     astNodesAreEquivalent(path, jsc.callExpression(jsc.identifier('foo'), jscUtils.ANY.literal))
//   to identify a call to `foo` with any literal.
//   Perhaps contribute such a thing upstream.
// - Where we directly use `jsc` we should probably replace that usage with jscodeshift extensions
//   and remove our peerDependency on jsc:
//   https://github.com/facebook/jscodeshift#extensibility
// - Write something to determine the closest shared scope. Seems `path` types have a `.scope`
//   property.

const jsc = require('jscodeshift');
// Notice recast is not in the project dependencies. We're deliberately using it transitively from
// jscodeshift.
const recast = require('recast');

const nodeTypes = Object.keys(jsc).filter((k) => jsc[k].kind === 'PredicateType');

// So we can do this:
//   jsc(src).find(jsc.Identifier).filter(chk.VariableDeclaration)
// Instead of:
//   jsc(src).find(jsc.Identifier).filter((path) => jsc.VariableDeclaration.check(path))
const chk = Object.assign({}, ...nodeTypes.map(key => ({ [key]: jsc[key].check.bind(jsc[key]) })));
const asrt = Object.assign({}, ...nodeTypes.map(key => ({ [key]: jsc[key].assert.bind(jsc[key]) })));
const not = (f) => (...args) => !f(...args);

// If supplied a node, return the node, otherwise resolve the node from the path
const resolveNode = (nodeOrPath) => nodeOrPath instanceof jsc.types.NodePath ? nodeOrPath.value : nodeOrPath;

// Check node equivalence. Useful for determining whether two variables have the same definition.
// Usage: astNodesAreEquivalent(path1.value, path2.value)
const astNodesAreEquivalent = (...args) => {
    const equiv = jsc.types.astNodesAreEquivalent;
    if (args.length === 0) {
        return equiv(...args);
    }
    if (args.length === 1) {
        // Return a partially evaluated expression
        return (...argsPartial) => astNodesAreEquivalent(
            ...args,
            ...argsPartial
        );
    }
    return equiv(resolveNode(args[0]), resolveNode(args[1]));
};

// TODO: this should probably either incorporate the .find method, so the user does not have to
//       say j.find(jsc.CallExpression).filter(callExpressionMatching) _or_ it should be
//       registered on Collection (see the jscodeshift docs, or src/collections/ in the
//       jscodeshift source code).
// TODO: strip comments from the supplied path/node?
const callExpressionMatching = (regex) => (nodeOrPath) =>
    recast.prettyPrint(resolveNode(nodeOrPath).callee, { wrapColumn: Infinity }).code.match(regex);

// Given an array of strings, construct a nested MemberExpression AST left-to-right. e.g.
// jscodeshift(buildNestedMemberExpression(['assert', 'equal'])).toSource() -> 'assert.equal'
const buildNestedMemberExpression = (members) =>
    members.reduce((acc, val) => jsc.memberExpression(
        typeof acc === 'string' ? jsc.identifier(acc) : acc,
        jsc.identifier(val))
    );

// Print the source code of a given expression
const summarise = (nodeOrPath) => recast.prettyPrint(resolveNode(nodeOrPath)).code;
const prettyPrint = (nodeOrPath) => console.log(summarise(nodeOrPath));

const astTypesInScope = (path, astType) => jsc(path.scope.path)
    .find(astType)
    .filter((p) => p.scope === path.scope);

// Given a path, find all identifiers in the same scope that are not object properties. I.e.
// any identifier in the same scope that would result in a name clash or shadow if a variable
// was declared with the same name in that scope. For this code:
//   () => {
//     let x;
//     const f = () => {}
//     setTimeout(f, 2000, x);
//   }
// we would return
//   new Set('x', 'f', 'setTimeout')
// because if we were to declare any of these names in the scope displayed, the name would
// clash with (x, f) or shadow (setTimeout) another.
const identifiersInSameScope = (path) => {
    const isMemberExpressionProperty = (path) =>
        jsc.MemberExpression.check(path.parentPath.value)
            && path.parentPath.value.property === path.value;
    return new Set(
        astTypesInScope(path, jsc.Identifier)
        .filter(not(isMemberExpressionProperty))
        .nodes()
        .map(n => n.name)
    );
};

const appendComment = (node, comment) => {
    if (!Array.isArray(node.comments)) {
        node.comments = [ comment ]
    } else {
        node.comments.push(comment);
    }
};

module.exports = {
    appendComment,
    asrt,
    astNodesAreEquivalent,
    astTypesInScope,
    buildNestedMemberExpression,
    callExpressionMatching,
    chk,
    identifiersInSameScope,
    not,
    prettyPrint,
};
