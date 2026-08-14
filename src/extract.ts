import { parseScript } from 'meriyah';
import * as estraverse from 'estraverse';

/**
 * Recursively search RPC registration arguments for a string literal that
 * looks like a service path ("/Service.Method"). Handles the classic
 * pattern (path array at args[2]) and newer shapes like
 * `new _.yD('rpcid', class{...}, mask, [_.Pg, !0, _.Sg, '/Svc.Method'])`
 * plus object-wrapped paths. Position-independent: the path array may sit
 * at any argument index, and non-literal args (class refs like CRb/BRb)
 * are simply skipped.
 */
export function findRpcPath(nodes: any[]): string | null {
  for (const n of nodes) {
    if (!n) continue;
    if (n.type === 'Literal' && typeof n.value === 'string' &&
        n.value.startsWith('/') && n.value.includes('.')) {
      return n.value.substring(1);
    }
    if (n.type === 'ArrayExpression') {
      const found = findRpcPath(n.elements);
      if (found) return found;
    }
    if (n.type === 'ObjectExpression') {
      const found = findRpcPath(n.properties.map((p: any) => p.value));
      if (found) return found;
    }
    if (n.type === 'TemplateLiteral' && n.quasis?.length === 1) {
      const cooked = n.quasis[0].value?.cooked;
      if (typeof cooked === 'string' && cooked.startsWith('/') && cooked.includes('.')) {
        return cooked.substring(1);
      }
    }
  }
  return null;
}

/** Registration-class call types, e.g. _.yD = "unary", _.eK = "server_streaming". */
const RPC_TYPE_RE = /unary|streaming|bidi/i;

/**
 * Find the call-type marker inside an RPC registration class definition:
 * `_.yD = class extends _.MPb { constructor(a,b,c,d){ super(a,b,c,d); this[_.Cua] = "unary" } }`
 * The property key (_.Cua) is obfuscated, so we match any `this[...] = "string"`
 * assignment whose value looks like an RPC call type.
 */
function findCallTypeInClass(classExpr: any): string | null {
  let type: string | null = null;
  estraverse.traverse(classExpr as any, {
    enter: (node: any) => {
      if (node.type === 'AssignmentExpression' &&
          node.left?.type === 'MemberExpression' &&
          node.left.object?.type === 'ThisExpression' &&
          node.right?.type === 'Literal' &&
          typeof node.right.value === 'string' &&
          RPC_TYPE_RE.test(node.right.value)) {
        type = node.right.value;
        return estraverse.VisitorOption.Break;
      }
    }
  });
  return type;
}

export interface ChunkExtraction {
  /** [rpcid, servicePath, registrationClassName] */
  entries: Array<[string, string, string | null]>;
  /** [className, callType] pairs from `_.X = class ... { this[_.Y] = "type" }` */
  classTypes: Array<[string, string]>;
}

/**
 * Class-agnostic RPC extraction from a single script chunk.
 * Matches any `new _.<Class>(...)` whose arguments contain a
 * "/Service.Method" literal; the rpcid is the first string argument.
 * Also collects registration-class call types (unary / server_streaming / ...).
 */
export function extractMappingsFromChunk(content: string): ChunkExtraction {
  const entries: Array<[string, string, string | null]> = [];
  const classTypes: Array<[string, string]> = [];
  try {
    const ast = parseScript(content, { next: true });
    estraverse.traverse(ast as any, {
      enter: (node: any) => {
        // 1. RPC registrations: `new _.<Class>("rpcid", ...)`
        if (node.type === 'NewExpression' &&
            node.callee?.type === 'MemberExpression' &&
            node.callee.object?.name === '_') {
          if (node.arguments.length < 2) return;
          const rpcIdArg = node.arguments[0];
          if (rpcIdArg?.type !== 'Literal' || typeof rpcIdArg.value !== 'string') return;
          const path = findRpcPath(node.arguments);
          if (path) {
            const className = node.callee.property?.type === 'Identifier' ? node.callee.property.name : null;
            entries.push([String(rpcIdArg.value), path, className]);
          }
          return;
        }
        // 2. Registration class defs: `_.yD = class extends _.MPb { ... }`
        if (node.type === 'AssignmentExpression' &&
            node.left?.type === 'MemberExpression' &&
            node.left.object?.name === '_' &&
            node.left.property?.type === 'Identifier' &&
            node.right?.type === 'ClassExpression') {
          const className = node.left.property.name;
          // Cheap pre-filter: skip the nested traversal for the vast majority
          // of classes that contain no call-type string at all.
          const span = content.slice(node.right.start ?? 0, node.right.end ?? content.length);
          if (RPC_TYPE_RE.test(span)) {
            const callType = findCallTypeInClass(node.right);
            if (callType) classTypes.push([className, callType]);
          }
        }
      }
    });
  } catch (e) {
    // Skip malformed
  }
  return { entries, classTypes };
}
