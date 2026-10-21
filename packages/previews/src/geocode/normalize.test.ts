import assert from "node:assert/strict";
import test from "node:test";

import { expandAddressVariantsForGeocoder, expandLocalityVariantsForGeocoder } from "./normalize";

test("expandAddressVariantsForGeocoder splits compound plaza and street references", () => {
  const variants = expandAddressVariantsForGeocoder(
    "Plaza Alcalde Tomas Carrión con Calle San Andrés",
  );

  assert.deepEqual(variants, [
    "Plaza Alcalde Tomas Carrión con Calle San Andrés",
    "Plaza Alcalde Tomas Carrión",
    "Calle San Andrés",
  ]);
});

test("expandAddressVariantsForGeocoder unwraps nested street labels", () => {
  const variants = expandAddressVariantsForGeocoder(
    "Calle Transversal a la Calle Cecilio Montes",
  );

  assert.deepEqual(variants, ["Calle Transversal a la Calle Cecilio Montes"]);
});

test("expandLocalityVariantsForGeocoder keeps both stripped and original locality hints", () => {
  const variants = expandLocalityVariantsForGeocoder(
    "Urbanización Parque del Cubillas",
  );

  assert.deepEqual(variants, ["Parque del Cubillas", "Urbanización Parque del Cubillas"]);
});

test("expandAddressVariantsForGeocoder normalizes campus site variants", () => {
  const variants = expandAddressVariantsForGeocoder(
    "Campus Bizzozero di Varese",
  );

  assert.deepEqual(variants, ["Campus Bizzozero di Varese", "Campus Bizzozero Varese"]);
});

test("expandAddressVariantsForGeocoder creates searchable university campus aliases", () => {
  const variants = expandAddressVariantsForGeocoder(
    "Campus Universitario de Segovia de la Universidad de Valladolid",
  );

  assert.deepEqual(variants, [
    "Campus Universitario de Segovia de la Universidad de Valladolid",
    "Campus Universitario Segovia de la Universidad de Valladolid",
    "Campus Segovia",
    "Campus Segovia Valladolid",
    "Campus Segovia UVa",
  ]);
});

test("expandAddressVariantsForGeocoder compresses IUT campus names into institutional aliases", () => {
  const variants = expandAddressVariantsForGeocoder(
    "campus IUT Nîmes Université de Montpellier",
  );

  assert.deepEqual(variants, [
    "campus IUT Nîmes Université de Montpellier",
    "campus IUT Nîmes Université Montpellier",
    "IUT Nîmes",
    "Institut Universitaire de Technologie de Nîmes",
  ]);
});

test("expandAddressVariantsForGeocoder keeps chinese village numbers and broader village aliases", () => {
  const variants = expandAddressVariantsForGeocoder("黄庄村43号");

  assert.deepEqual(variants, ["黄庄村43号", "黄庄村"]);
});

test("expandAddressVariantsForGeocoder reorders french number-leading street addresses", () => {
  const variants = expandAddressVariantsForGeocoder(
    "34 avenue d'Izon",
  );

  assert.deepEqual(variants, ["34 avenue d'Izon", "avenue d'Izon 34"]);
});

test("expandLocalityVariantsForGeocoder keeps stripped variants for european site wrappers", () => {
  const variants = expandLocalityVariantsForGeocoder(
    "Lotissement Herbstweg",
  );

  assert.deepEqual(variants, ["Herbstweg", "Lotissement Herbstweg"]);
});

test("expandAddressVariantsForGeocoder strips non-campus site wrappers for broader geocoding", () => {
  const variants = expandAddressVariantsForGeocoder(
    "Urbanización Prado Cerrado",
  );

  assert.deepEqual(variants, ["Urbanización Prado Cerrado", "Prado Cerrado"]);
});

test("expandAddressVariantsForGeocoder strips french site wrappers and keeps city-bound variants", () => {
  const variants = expandAddressVariantsForGeocoder(
    "ZAC Val de Sermon Ilot B à Mordelles",
  );

  assert.deepEqual(variants, [
    "ZAC Val de Sermon Ilot B à Mordelles",
    "Val de Sermon Ilot B à Mordelles",
    "ZAC Val de Sermon Ilot B",
    "ZAC Val de Sermon Ilot B Mordelles",
  ]);
});

test("expandAddressVariantsForGeocoder strips facility lead-ins before german street tails", () => {
  const variants = expandAddressVariantsForGeocoder(
    "Begegnungszentrum Westerwaldstraße",
  );

  assert.deepEqual(variants, ["Begegnungszentrum Westerwaldstraße", "Westerwaldstraße"]);
});

test("expandAddressVariantsForGeocoder adds chinese institution cores and street-number variants", () => {
  const variants = expandAddressVariantsForGeocoder(
    "黄冈师范学院东校区学生宿舍A、B栋",
  );

  assert.deepEqual(variants, [
    "黄冈师范学院东校区学生宿舍A、B栋",
    "黄冈师范学院东校区",
    "黄冈师范学院",
  ]);
});

test("expandAddressVariantsForGeocoder keeps spaced chinese road-number variants for nominatim", () => {
  const variants = expandAddressVariantsForGeocoder("燕江东路86号");

  assert.deepEqual(variants, ["燕江东路86号", "燕江东路 86 号", "燕江东路"]);
});
