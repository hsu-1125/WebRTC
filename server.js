const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const dataMap = new Map(); //正常連線後，儲存 socket.id 對應到的 userID 及 roomID，斷線後清除
const callingSet = new Set(); //成功通話後，儲存 socket.id，發送 leave 後清除，用於判斷突然斷線的使用者
const global = require('./global.js')();

io.on('connection', (socket) => {
    console.log(`${socket.id} connected`);
    socket.emit('connected');

    socket.on('create', (roomID, userID, targetID) => {
        console.log(`server receive create from ${userID}`);

        for (var mapValue of dataMap.values()) {
            if (mapValue.userID === userID) {
                socket.emit('created');
                console.log(`server emit created to ${userID}`);
                return;
            } else if (mapValue.userID === targetID) {
                socket.emit('busy');
                console.log(`server emit busy to ${userID}`);
                return;
            }
        }

        socket.join(roomID);
        setDataMap(socket.id, userID, roomID);

        if (targetID) { //1 to 1
            //TODO("發送推播給對方")
        } else { // Many to Many
            //TODO("不做任何事")
        }
    });

    socket.on('sign', (roomID, userID) => {
        console.log(`server receive sign from ${userID}`);
        const members = io.sockets.adapter.rooms.get(roomID);
        console.log('room members', members);

        if (!members) {
            socket.emit('finished');
            console.log(`server emit finished to ${userID}`);
        } else if (members.size === 2) {
            socket.emit('joined');
            console.log(`server emit joined to ${userID}`);
        } else {
            setDataMap(socket.id, userID, roomID);
        }
    });

    socket.on('noReply', (roomID, userID) => {
        console.log(`server receive noReply from ${userID}`);

        const members = io.sockets.adapter.rooms.get(roomID);
        console.log('room members', members);

        if (members && members.size < 2) {
            io.to(roomID).emit('noReply');
            console.log(`server emit noReply to roomID ${roomID}`);
        }
    });

    socket.on('cancel', (roomID, userID, targetID) => {
        console.log(`server receive cancel from ${userID}`);
        socket.leave(roomID);

        for (var [socketId, mapValue] of dataMap) {
            if (mapValue.userID === targetID) {
                io.to(socketId).emit('cancel');
                console.log(`server emit cancel to socketId ${socketId}`);
            }
        }
    });

    socket.on('reject', (roomID, userID) => {
        console.log(`server receive reject from ${userID}`);

        const members = io.sockets.adapter.rooms.get(roomID);
        console.log('room members', members);

        if (members && members.size < 2) {
            io.to(roomID).emit('reject');
            console.log(`server emit reject to roomID ${roomID}`);

            for (var [socketId, mapValue] of dataMap) {
                if (socketId !== socket.id && mapValue.userID === userID) {
                    io.to(socketId).emit('rejected');
                    console.log(`server emit rejected to socketId ${socketId}`);
                }
            }
        }
    });

    socket.on('join', (roomID, userID) => {
        console.log(`server receive join from ${userID}`);

        const members = io.sockets.adapter.rooms.get(roomID);
        console.log('room members', members);

        if (members) {
            for (var [socketId, mapValue] of dataMap) {
                if (mapValue.userID === userID && callingSet.has(socketId)) {
                    io.to(socket.id).emit('joined');
                    console.log(`server emit joined to socketId ${socket.id}`);
                    return;
                }
            }

            io.to(roomID).emit('start', userID);
            console.log(`server emit start to roomID ${roomID}`);

            setDataMap(socket.id, userID, roomID);
            socket.join(roomID);

            members.forEach((socketId) => {
                callingSet.add(socketId);
            });
            console.log('callingSet', callingSet);

        } else { 
            socket.emit('finished');
            console.log(`server emit finished to ${userID}`);
        }

        for (var [socketId, mapValue] of dataMap) {
            if (socketId !== socket.id && mapValue.userID === userID) {
                io.to(socketId).emit('joined');
                console.log(`server emit joined to socketId ${socketId}`);
            }
        }
    });

    socket.on('leave', (roomID, userID) => {
        console.log(`server receive leave from ${userID}`);
        socket.leave(roomID);
        callingSet.delete(socket.id);

        const members = io.sockets.adapter.rooms.get(roomID);
        console.log('room members', members);

        if (members) {
            io.to(roomID).emit('leave', userID);
            console.log(`server emit leave to roomID ${roomID}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`${socket.id} disconnected`);

        if (callingSet.has(socket.id)) {
            const data = dataMap.get(socket.id);

            const members = io.sockets.adapter.rooms.get(data.roomID);
            console.log('room members', members);

            if (members) {
                io.to(data.roomID).emit('leave', data.userID);
                console.log(`server emit leave to roomID ${data.roomID}`);
            }
        }

        callingSet.delete(socket.id);
        console.log('callingSet remain', callingSet);

        dataMap.delete(socket.id);
        console.log('dataMap remain', dataMap);
    });
})

/*server.listen(3001, function () {
    console.log('Express https server listening on port ' + 3001);
});*/

app.use(express.static("views"));
app.set('view engine', 'ejs');

app.set('port', process.env.PORT || 3001);

server.listen(app.get('port'), function(){
    console.log('Express server listening on port ' + app.get('port'));
});
require('./global.js')(app, global);

app.get('/', function (req, res) {
    res.send('Hello World!');
});

app.get('/O2O', function (req, res) {
    let identity = req.query.identity;
    const roomID = req.query.room;
    const userID = req.query.id;
    const targetID = req.query.target;

    if (identity && roomID && userID && targetID) {
        //無法用房間是否存在來判斷為建立者或加入者，因為建立者取消通話，房間就會不存在
        identity = (identity === '2') ? 'joiner' : 'creator'
        console.log(`${userID} is ${identity}`);

        res.render('room', {
            identity: identity,
            mode: 1,
            roomID: roomID,
            userID: userID,
            targetID: targetID
        });
    } else {
        res.send("Missing parameters");
    }
});

app.get('/M2M', function (req, res) {
    const roomID = req.query.room;
    const userID = req.query.id;

    if (roomID && userID) {
        //若房間已存在，則為加入者，反之為建立者
        const members = io.sockets.adapter.rooms.get(roomID);
        const identity = (members) ? 'joiner' : 'creator'
        console.log(`${userID} is ${identity}`);

        res.render('room', {
            identity: identity,
            mode: 2,
            roomID: roomID,
            userID: userID,
            targetID: null
        });
    } else {
        res.send("Missing parameters");
    }
});

function setDataMap(socketId, userID, roomID) {
    dataMap.set(
        socketId,
        {
            userID: userID,
            roomID: roomID
        }
    );
    console.log('dataMap', dataMap);
}