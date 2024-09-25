const Joi = require('joi');
const { objectId } = require('./custom.validation');

const create = {
  body: Joi.object().keys({
    name: Joi.string().required()
  }),
};
const getList = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    searchBy: Joi.string().allow('').allow(null),
    status: Joi.string().allow('').allow(null),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getById = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
};

const update = {
  params: Joi.object().keys({
    id: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string().required(),
      isProduct: Joi.allow('').allow(null),
      status: Joi.allow('').allow(null),
      isDelete: Joi.allow('').allow(null),
      createdAt: Joi.allow('').allow(null),
      updatedAt: Joi.allow('').allow(null),
      id: Joi.string(),
    })
    .min(1),
};

const deleteById = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
};

module.exports = {
  create,
  getList,
     getById,
  update,
  deleteById,
};
