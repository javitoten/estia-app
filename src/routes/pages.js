module.exports = ({ get }) => {
  require("./pages_dashboard")({ get });
  require("./pages_properties")({ get });
  require("./pages_global")({ get });
  require("./pages_calendar")({ get });
  require("./pages_settings")({ get });
};
