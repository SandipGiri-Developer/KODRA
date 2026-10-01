module.exports = function (source) {
  return source
    .replace(
      /generateUUID\.name\s*=\s*name;/g,
      'Object.defineProperty(generateUUID, "name", { value: name, configurable: true });'
    )
    .replace(
      /null\.error;/g,
      'var errorProto = Error.prototype; INTRINSICS[\'%Error.prototype%\'] = errorProto;'
    )
    .replace(
      /var ThrowTypeError = \$gOPD[\s\S]*?:\s*throwTypeError;/g,
      'var ThrowTypeError = ($gOPD && $gOPD(arguments, "callee")) ? $gOPD(arguments, "callee").get : throwTypeError;'
    )
    .replace(
      /if\s*\(\s*new\s+Parser\(\)\.parseFromString/g,
      'if (typeof Parser === "function" && new Parser().parseFromString'
    );
};
