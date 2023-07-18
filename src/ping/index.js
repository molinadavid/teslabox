const log = require("../log");

const _ = require("lodash");
const async = require("async");
const ping = require("ping");

const settings = {
  interval: 2000,
  timeout: 20,
  hosts: [
    "1.1.1.1",
    "1.0.0.1",
    "8.8.8.8",
    "8.8.4.4",
    "9.9.9.9",
    "149.112.112.112",
  ],
};

let isAlive;

exports.start = (cb) => {
  cb = cb || function () {};

  async.forever((next) => {
    async.someSeries(
      _.shuffle(settings.hosts),
      (host, cb) => {
        ping.sys.probe(
          host,
          (result) => {
            if (result) {
              return cb(null, true);
            }

            log.debug(`[ping] ${host} failed`);
            setTimeout(cb, settings.interval);
          },
          { timeout: settings.timeout }
        );
      },
      (_, result) => {
        if (result) {
          if (typeof isAlive === "undefined") {
            log.info("[ping] connection established");
          } else if (!isAlive) {
            log.info("[ping] connection re-established");
          }
        } else if (isAlive) {
          log.warn("[ping] connection lost");
        }

        isAlive = result;
        setTimeout(next, settings.interval);
      }
    );
  });

  cb();
};

exports.isAlive = () => {
  return !!isAlive;
};
