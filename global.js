module.exports =
    function() {
        //var request = require('request');

        //var host_local = 'http://140.124.73.217:40002/api/';
        //var host_dev = 'https://api-dev.italkutalk.com/api/';
        var host_dev = 'http://10.0.1.210/api/';
        var host_online = 'https://api.italkutalk.com/api/';

        this.host = function() {
            if (process.env.node_env == "production") return host_online;
			else if (process.env.node_env == "develop") return host_dev;
			else return host_dev; // 這裡可以改成 local
        };
    };
