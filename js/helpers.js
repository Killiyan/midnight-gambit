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

Handlebars.registerHelper("capitalize", str => {
  return str.charAt(0).toUpperCase() + str.slice(1);
});

Handlebars.registerHelper("subtract", function(a, b) {
  return a - b;
});

Handlebars.registerHelper("sparkShouldFill", function(index, total, used) {
  const remaining = total - used;
  return index <= remaining;
});

//Filter Items Handlebar
Handlebars.registerHelper("filterItems", function(items, type) {
  return items.filter(item => item.type === type);
});

Handlebars.registerHelper("eq", function(a, b) {
  return a === b;
});

Handlebars.registerHelper("join", function(array, separator) {
  return Array.isArray(array) ? array.join(separator) : "";
});

Handlebars.registerHelper("includes", function(array, value) {
  return Array.isArray(array) && array.includes(value);
});

