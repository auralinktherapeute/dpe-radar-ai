module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo lit nativement les `paths` du tsconfig depuis le SDK 49 :
  // ajouter module-resolver par-dessus casse la chaine de transformation.
  return { presets: ['babel-preset-expo'] };
};
