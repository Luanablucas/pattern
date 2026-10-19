"use strict";
module.exports=function registerFocusRoutes(app,db) {
  require("./src/routes/focus")(app,db);
};
