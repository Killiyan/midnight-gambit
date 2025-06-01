//Adding Handlebars range for Strain later
Handlebars.registerHelper("range", function (start, end, options) {
  let result = "";
  for (let i = start; i <= end; i++) {
    result += options.fn(i);
  }
  return result;
});

Handlebars.registerHelper("riskShouldFill", function (index, dice, used) {
  return index <= (dice - used);
});

//Adding Handlebars range for Strain later
Handlebars.registerHelper("range", function (start, end, options) {
  let result = "";
  for (let i = start; i <= end; i++) {
    result += options.fn(i);
  }
  return result;
});

Handlebars.registerHelper("riskShouldFill", function (index, dice, used) {
  return index <= (dice - used);
});

Handlebars.registerHelper("json", function(context) {
  return JSON.stringify(context, null, 2);
});
