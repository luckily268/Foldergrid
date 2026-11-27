(function (root) {
  "use strict";
  const themes = {
    aurora: ["极光", "radial-gradient(ellipse at 10% 5%,#709bd5aa,transparent 65%),radial-gradient(ellipse at 90% 95%,#9d76c4aa,transparent 65%),#26354be8"],
    sunset: ["落日", "radial-gradient(ellipse at 10% 5%,#ffb186bb,transparent 65%),radial-gradient(ellipse at 90% 95%,#a965a5aa,transparent 65%),#503951eb"],
    ocean: ["深海", "radial-gradient(ellipse at 0 0,#5acbd2aa,transparent 65%),radial-gradient(ellipse at 100% 100%,#6075d6aa,transparent 65%),#18384eea"],
    forest: ["森林", "radial-gradient(ellipse at 0 0,#c1d9ad88,transparent 65%),radial-gradient(ellipse at 100% 100%,#4e8d7a99,transparent 65%),#263f36eb"],
    dusk: ["暮色", "radial-gradient(ellipse at 5% 0,#ba8fcb99,transparent 60%),radial-gradient(ellipse at 95% 100%,#6f8ec6aa,transparent 65%),#36304ce8"],
    peach: ["蜜桃", "radial-gradient(ellipse at 0 0,#e7c4b5aa,transparent 60%),radial-gradient(ellipse at 100% 100%,#d08c9c99,transparent 65%),#6d505be8"],
    glacier: ["冰川", "radial-gradient(ellipse at 0 0,#d8edf099,transparent 60%),radial-gradient(ellipse at 100% 100%,#709fc7aa,transparent 65%),#465c70eb"],
    midnight: ["午夜", "radial-gradient(ellipse at 15% 0,#3d5797aa,transparent 65%),radial-gradient(ellipse at 95% 100%,#563e7788,transparent 65%),#131d32ed"]
  };
  if (typeof module === "object" && module.exports) module.exports = themes;
  else root.cellThemes = themes;
})(typeof window === "undefined" ? globalThis : window);
