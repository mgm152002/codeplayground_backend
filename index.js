const express = require('express')
const Docker = require('dockerode');
const body_parser = require('body-parser')
const fs= require('fs');
const { exec } = require('child_process');
const docker = new Docker();
const { idgen } = require('./id_gen');
const { spawn } = require('child_process');
var AWS = require('aws-sdk');
var cors = require('cors')
require('aws-sdk/lib/maintenance_mode_message').suppress = true;
require('dotenv').config()
 
const app = express()
app.use(cors())

app.use(body_parser.urlencoded({ extended: true }))
AWS.config.update({
    region: process.env.Region,
    accessKeyId: process.env.accessKeyId,
    secretAccessKey: process.env.secretAccessKey
});

    // Copy code file into Docker container
    function startDocker(id, callback) {
        const dockerStart = spawn('docker', ['start', id]);
    
        dockerStart.stderr.on('data', (data) => {
            console.error('Error starting Docker container:', data.toString());
            callback(data.toString(), null);
        });
    
        dockerStart.on('close', (code) => {
            if (code === 0) {
                console.log('Docker container started');
                callback(null, 'Docker container started');
            }
        });
    }
    
    function executeDockerAndDelete(id, res ) {
     
        exec(`docker cp ./code.c ${id}:/usr/src/app`, (err, stdout, stderr) => {
            if (err) {
                console.error('Error copying code file:', err);
                res.status(500).send({ error: 'Error starting Docker container', details: err });
                return;
            }
            console.log('Code file copied successfully');
        
            // Start Docker container
            startDocker(id, (error, message) => {
                if (error) {
                    res.status(500).send({ error: 'Error starting Docker container', details: error });
                    return;
                }
        
                // Execute commands in Docker container
                const dockerExecCmd = `docker exec ${id} sh -c "gcc -o code code.c && ./code"`;
                // if (process.platform === 'win32') {
                //     // Prefix the command with 'winpty' for Windows platforms
                //     dockerExecCmd = `winpty ${dockerExecCmd}`;
                // }
        
                exec(dockerExecCmd, (error, stdout, stderr) => {
                    if (error) {
                        console.error('Error compiling/executing:', error);
                        fs.unlink('code.c', (err) => {
                            if (err) {
                                console.error('Error deleting code.c:', err);
                                return;
                            }
                            console.log('code.c deleted successfully');
                        });
            
                        // Remove the Docker container
                        exec(`docker rm -f ${id}`, (error, stdout, stderr) => {
                            if (error) {
                                console.error('Error removing Docker container:', error);
                                return;
                            }
                            console.log('Docker container removed');
                        });

                        res.status(500).send({ error: 'Error compiling/executing', details: stderr });
                        return;
                    }
                    console.log('Code compiled and executed successfully');
                    const s3 = new AWS.S3();
                    const params = {
                        Bucket: 'codeplayground',
                        Key: `${id}_${id}.c`,
                        Body: fs.createReadStream('./code.c')
                    };
                    s3.upload(params, (err, data) => {
                        if (err) {
                            console.log('Error uploading file:', err);
                        } else {
                            console.log('File uploaded successfully. File location:', data.Location);
                            fs.unlink('code.c', (err) => {
                                if (err) {
                                    console.error('Error deleting code.c:', err);
                                    return;
                                }
                                console.log('code.c deleted successfully');
                            });
                        }
                    });
        
                    // Delete code.c file
                   
        
                    // Remove the Docker container
                    exec(`docker rm -f ${id}`, (error, stdout, stderr) => {
                        if (error) {
                            console.error('Error removing Docker container:', error);
                            return;
                        }
                        console.log('Docker container removed');
                    });
                    
        
                    // Send response with stdout data
                    res.status(200).send({ out: stdout });
                });
            });
        });
    }


app.post('/compile', function (req, res){

    fs.writeFile(`code.${req.body.lang}`, req.body.code, (err) => {
        if (err) {
            console.error('Error writing code file:', err);
            res.status(500).send({ error: 'Error writing code file', details: err });
            return;
        }
        console.log('Code file saved!');
        var id=idgen(5)
       exec(`docker create -i --name ${id} comp`,(err)=>{
        if(err) {
            console.log("Error creating container")
        }

        
           
        

       
        executeDockerAndDelete(id, res )

       })
      
       
})
})
    

app.listen(8000,()=>{
console.log('listening on 8000')
})

