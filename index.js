// libraries and such
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const crypto = require('crypto');
const GoogleAuth = require('google-auth-library');

// google account authenciation
const auth = new GoogleAuth;
const client = new auth.OAuth2('608787834828-71306h3l0d8tfg0ooudb8enkm7dd1ta3.apps.googleusercontent.com', '', '');

// server port
const port = process.env.PORT || 3000

// user object standard - {id: socketID, name: googleName, occupation: teacher/student}
function Room(name) {
  this.name = name;
  // room properties
  // [socket id, google name]
  this.teachers = new Map();
  this.students = new Map();;
  // [unique socket event, {teacher: id, student: id}]
  this.lines = new Map();
  this.lineIndex = 0;
  // room methods
  this.join = function(user,socketID) {
    if (user.occupation == "teacher") {
      this.teachers.set(socketID,user.name);
    } else if (user.occupation == "student") {
      this.students.set(socketID,user.name);
    }
  };
  this.leave = function(user,socketID) {
    if (user.occupation == "teacher") {
      this.teachers.delete(socketID);
    } else if (user.occupation == "student") {
      this.students.delete(socketID);
    }
  };
  this.live = function() {
    if (this.teachers.size > 0) {
      return true;
    } else {
      return false;
    }
  };
  this.updateLineIndex = function() {
    if (this.lineIndex < this.teachers.size - 1) {
      this.lineIndex++;
    } else if (this.lineIndex == this.teachers.size - 1) {
      this.lineIndex = 0;
    }
  };
  this.helpLine = function(student,socketID) {
    var uniqueEventID = crypto.randomBytes(10).toString('hex');
    var lineObject = {
      stu: socketID,
      stuName: student.name,
      teach: Array.from(this.teachers.keys())[this.lineIndex],
      teachName: Array.from(this.teachers.values())[this.lineIndex],
      lineID: uniqueEventID,
      room: this.name
    };
    this.lines.set(uniqueEventID,lineObject);
    io.to(lineObject.stu).emit('new-line',lineObject);
    io.to(lineObject.teach).emit('new-line',lineObject);
    this.updateLineIndex();
  };
}

// the room architecture
const AllConnected = new Room("Big");
// rooms
const AlgebraOne = new Room("Alg1");
const Geometry = new Room("Geo");
// room directory
const identifiersArray = [['Alg1',AlgebraOne],['Geo',Geometry]];
const roomIdentifiers = new Map(identifiersArray);

// sending files
app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});
app.use(express.static('src'));

// event-driven websockets communication
io.on('connection', function(socket){

  socket.on('verify',function(id){
    client.verifyIdToken(
    id,
    '608787834828-71306h3l0d8tfg0ooudb8enkm7dd1ta3.apps.googleusercontent.com',
    function(e, login) {
      var payload = login.getPayload();
      var userid = payload['sub'];
      // var domain = payload['hd'];
      /* if (domain === 'cheshire.k12.ct.us') {
        io.to(socket.id).emit('verify', true);
      } */
      if (payload.name.includes("(")) {
        socket.emit('verify',true,'student');
        AllConnected.students.set(socket.id,payload.name);
      } else {
        socket.emit('verify',true,'teacher');
        AllConnected.teachers.set(socket.id,payload.name);
      }
    });
  });

  socket.on('joinRequest', (room,user) => {
    socket.join(room);
    roomIdentifiers.get(room).join(user,socket.id);
  });

  socket.on('leaveRequest', (room,user) => {
    socket.leave(room);
    roomIdentifiers.get(room).leave(user,socket.id);
  });

  setInterval(function(){
    // update all clients on which rooms are active
    var liveRoomUpdate = [];
    for (var [key,value] of roomIdentifiers) {
      if (value.live()) {
        liveRoomUpdate.push(key);
      }
    }
    io.emit('live rooms update',liveRoomUpdate)
  }, 1000);

  socket.on('msg', (msg,room,sender) => {
    io.in(room).emit('msg',msg,room,sender);
  });

  socket.on('help req', (room,student) => {
    roomIdentifiers.get(room).helpLine(student,socket.id);
  });

  socket.on('line-message', (eventID,msg,room,sender) => {
    var whichRoom = roomIdentifiers.get(room);
    var transmit = whichRoom.lines.get(eventID);
    if (sender.occupation == 'student') {
      io.to(transmit.teach).emit('line-message',eventID,msg,room,sender);
    } else if (sender.occupation == 'teacher') {
      io.to(transmit.stu).emit('line-message',eventID,msg,room,sender);
    }

  });

  socket.on('disconnect', function() {
    for (var [key,value] of roomIdentifiers) {
      value.teachers.delete(socket.id);
      value.students.delete(socket.id);
    }
    AllConnected.teachers.delete(socket.id);
    AllConnected.students.delete(socket.id);
  });

});

// http sever up and running
http.listen(port, function(){
  console.log('listening on *:' + port);
});
