/* eslint-disable no-param-reassign */

/**
 * Mongoose schema plugin applied in the toJSON transform call:
 *  - replaces `_id` with `id`
 *  - removes `__v`
 *  - removes any path flagged `private: true`
 */

const deleteAtPath = (obj, path, index) => {
  if (!obj) return;
  if (index === path.length - 1) {
    delete obj[path[index]];
    return;
  }
  deleteAtPath(obj[path[index]], path, index + 1);
};

const toJSON = (schema) => {
  let transform;

  if (schema.options.toJSON && schema.options.toJSON.transform) {
    transform = schema.options.toJSON.transform;
  }

  schema.options.toJSON = Object.assign(schema.options.toJSON || {}, {
    transform(doc, ret, options) {
      Object.keys(schema.paths).forEach((path) => {
        if (schema.paths[path].options && schema.paths[path].options.private) {
          deleteAtPath(ret, path.split("."), 0);
        }
      });

      if (ret._id) {
        ret.id = ret._id.toString();
      }
      delete ret._id;
      delete ret.__v;

      if (transform) {
        return transform(doc, ret, options);
      }
    },
  });
};

export default toJSON;
