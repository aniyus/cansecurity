/*global module, require, Buffer, console */
var _ = require( 'lodash' ),
	crypto = require( 'crypto' ),
	tokenlib = require( './token' ),
	getUser, publicMethods, validatePass, validate,
    authCallback,fb,
	errors = require( './errors' ),
	constants = require( './constants' ).get(),
	debug = false,fbValidate,
	warn = function (msg) {
		if (debug) {
			console.error(msg);
		}
	};
 var graph =null;

// set up warn on tokenlib
tokenlib.setWarn(warn);

var USERHEADER = constants.header.USER,
	AUTHHEADER = constants.header.AUTH,
	AUTHMETHODHEADER = constants.header.AUTHMETHOD,
	AUTHSESSION = constants.header.AUTHSESSION ,
	CORSHEADER = constants.header.CORS,
	SESSIONEXPIRY = 15, // minutes
	sessionExpiry, hasInit = false,
	encryptHeader = false,
	RANDOM_STRING_LENGTH = 60;

/*jslint regexp:true */
var MSGRE = /^error=(.+)$/;
/*jslint regexp:false */

///////////////
//// UTILS ////
///////////////

var fnOrNull = function ( f ) {
	return ( f && typeof ( f ) === "function" ? f : null );
},
genRandomString = function ( length ) {
	return crypto.randomBytes( length )
		.toString( 'hex' );
};


/////////////////////
//// CREDENTIALS ////
/////////////////////

var requestHasBasicAuthCredentials = function ( request ) {
	return request.headers.authorization && request.headers.authorization.indexOf( "Basic " ) === 0;
}, getBasicAuthCredentials = function ( request ) {
    //console.log("i am here yaar aniyus");
	var header = new Buffer( request.headers.authorization.split( ' ' )[ 1 ], 'base64' )
		.toString()
		.split( ":" );
	if ( header && header.length === 2 ) {
		return {
			user: header[ 0 ],
			password: header[ 1 ]
		};
	}
	return null;
}, getAuthCredentials = function ( req ) {
    if(req.session[ AUTHSESSION ] && req.session[ AUTHSESSION ].user!=null){
        
    }else if(req.headers.authorization && req.headers.authorization.indexOf("HIM")==0 ){
        var header =req.headers.authorization.split( ' ' )[ 1 ].split( ":" );
        return { user: header[ 0 ], password:header[1],accountType:"LOCAL"};        
    }else if(req.headers.authorization && req.headers.authorization.indexOf("POST")==0){
          return { user: req.body.userId, password:req.body.password,accountType:"LOCAL"};
	}else if(req.headers.authorization && req.headers.authorization.indexOf("FB")==0){
          return { user: req.body.userId, password:req.body.password,accountType:"FB"};
	}
    else if ( requestHasBasicAuthCredentials( req ) ) {
		return getBasicAuthCredentials( req );
	}
	return null;
}, appendCORSHeader = function ( response ) {
	var existing = response.get( CORSHEADER ) || "";
	response.set( CORSHEADER, _.compact( existing.split( /,/ ) )
		.concat( [ AUTHHEADER, USERHEADER ] )
		.join( "," ) );
},
getAuthTokenFromHeaders = function ( req ) {
	var authToken = req.headers[ AUTHHEADER ] || req.headers[ AUTHHEADER.toLowerCase() ];

	if ( !authToken ) {return null;}

	if ( encryptHeader ) {
		authToken = tokenlib.decipher( authToken );
	}

	var authTokenParts = authToken.split( ':' );
	var auth = {
		valid: authTokenParts.length >= 2,
		token: authToken,
		hash: authTokenParts[ 0 ],
		user: authTokenParts[ 1 ],
		expiry: authTokenParts[ 2 ]
	};

	return auth;
};


/////////////////
//// SESSION ////
/////////////////

var setupSessionData = function ( request, user, login, expiry ) {
	if ( request.session ) {
		request.session[ AUTHSESSION ] = {
			user: user,
			login: login,
			expiry: expiry
		};
		request.session.touch();
	}
},
setupSessionHeaders = function ( request, response, user, login, password, method, expiry ) {
	var userAsJson;
	request[ AUTHHEADER ] = user || {};
	request[ AUTHMETHODHEADER ] = method;
	userAsJson = JSON.stringify( request[ AUTHHEADER ] );
	response.header( AUTHHEADER, "success=" + tokenlib.generate( login, password, expiry ) );
//	response.header( USERHEADER, encryptHeader ? tokenlib.cipher( userAsJson ) : userAsJson );
   // console.log("aniyus",request);
},
removeSessionData = function ( request ) {
	if ( request.session ) {
		delete request.session[ AUTHSESSION ];
	}
},
clearHeaders = function ( response ) {
	response.removeHeader( AUTHHEADER );
	response.removeHeader( USERHEADER );
},
endSession = function ( request, response ) {
	removeSessionData( request );
	clearHeaders( response );
},
cantStablishSession = function ( req, res, next ) {
	endSession( req, res );
	next();
},
prepareErrorHeaders = function ( response, message ) {
	response.header( AUTHHEADER, "error=" + message );
	response.removeHeader( USERHEADER );
},
endSessionWithErrorMessage = function ( request, response, message ) {
	removeSessionData( request );
	//prepareErrorHeaders( response, message );
},
getSessionDataFromRequest = function ( request ) {
	var session = {};
	if ( request.session ) {
		session.auth = request.session[ AUTHSESSION ] || null;

		if ( session.auth ) {
			session.user = session.auth.user;
		}
		
	}

	return session;
},
startSession = function ( config ) {
	var req = config.req,
		res = config.res,
		expiry = Date.now() + sessionExpiry;

	appendCORSHeader( res );
	setupSessionData( req, config.user, config.login, expiry );
	setupSessionHeaders( req, res, config.user, config.login, config.password, config.method, expiry );
};




///////////////////
//// CALLBACKS ////
///////////////////

var validateCallback = function ( success, user, message, pass ) {
	if ( success && user ) {
		warn("Successfully validated "+user+" via basic auth");
		startSession( {
			req: this.req,
			res: this.res,
			user: user,
			login: this.creds.user,
			password: pass,
			method: constants.method.CREDENTIALS
		} );
		this.next();
	} else {
		warn("Failed to validate user via basic auth");
		endSessionWithErrorMessage( this.req, this.res, message );
         if(authCallback){
            authCallback( this.req,this.res,401, errors.unauthenticated( message ) ,"validateUser");
        }else{
		  this.res.send( 401, errors.unauthenticated( message ) );
        }
	}
},
validateLegacyCallback = function ( user, message, pass ) {
	if ( user ) {
		warn("Successfully validated "+user+" via basic auth legacy");
		startSession( {
			req: this.req,
			res: this.res,
			user: user,
			login: this.creds.user,
			password: pass,
			method: constants.method.CREDENTIALS
		} );
		this.next();
	} else {
		warn("Failed to validate user via basic auth legacy");
		endSessionWithErrorMessage( this.req, this.res, message );
        if(authCallback){
            authCallback( req,res,401, errors.unauthenticated( message ) ,"validateUser");
        }else{
		  this.res.send( 401, errors.unauthenticated( message ) );
        }
	}
},
validateWithAuthTokenCallback = function ( success, user, login, pass ) {
	var authToken = this.auth.token;
	if ( success && tokenlib.validate( authToken, login, pass ) ) {
		warn("Successfully validated "+user+" via auth token");
		startSession( {
			req: this.req,
			res: this.res,
			user: user,
			login: login,
			password: pass,
			method: constants.method.TOKEN
		} );
	} else {
		warn("Failed to validate "+user+" via auth token");
		endSessionWithErrorMessage( this.req, this.res, errors.invalidtoken() );
	}
	this.next();
},
validateGetUserSuccessCallback = function ( user, login, password ) {
	var authToken = this.auth.token;
	if ( tokenlib.validate( authToken, login, password ) ) {
		warn("Successfully validated "+user+" via getUser");
		startSession( {
			req: this.req,
			res: this.res,
			user: user,
			login: login,
			password: password,
			method: constants.method.TOKEN
		} );
	} else {
		warn("Failed to validate user via getUser");
		endSessionWithErrorMessage( this.req, this.res, errors.invalidtoken() );
	}
	this.next();
},
validateGetUserFailureCallback = function () {
	warn("Failed to validate user via authToken using getUser");
	endSessionWithErrorMessage( this.req, this.res, errors.invalidtoken() );
	this.next();
};

var validateInFB=function(user,password,callback,contextFun){
   
    if(graph && graph!=null){
        //graph.setAccessToken(password);  
        graph.get("/me",{access_token:password}, function(err, res) {
            if(err || user!=res.id){
                callback(user,password,contextFun,null);
            }else{ 
              var uid = user+"@facebook.com";
              callback(user,password,contextFun,res);
            }
         });
    }else{
      callback(user,password,contextFun,null);
    }
   
    
}

//////////////////////////
//// SESSION CREATION ////
//////////////////////////

var tryStartSessionWithBasicAuthCredentials = function ( req, res, next ) {
	var creds = getAuthCredentials( req );
	warn("Try Session with Basic Auth Creds for "+req.url);
	if ( creds ) {
		warn("Basic Auth Creds found for "+creds.user);
		var validateFunc = validate || validatePass;
		var validateCallbackFunc = ( validate ? validateCallback : validateLegacyCallback );
        
		var context = {
			req: req,
			res: res,
			next: next,
			creds: creds
		};
        if(creds.accountType=="FB"){
            validateInFB(creds.user, creds.password,fbValidate||validateFunc,validateCallbackFunc.bind( context ));
        }else{
            
		  validateFunc( creds.user, creds.password, validateCallbackFunc.bind( context ) );
        }
		return true;
	}
	return false;
},
tryStartWithPreviousSessionData = function ( req, res, next ) {
	var session = getSessionDataFromRequest( req ), ret;
	warn("Try Session with Previous express session data for "+req.url);

	if ( session.user ) {
		warn("Session user found");
		if ( session.auth.expiry > Date.now() ) {
			warn("Session still valid");
			startSession( {
				req: req,
				res: res,
				user: session.user,
				login: session.auth.login,
				password: session.user.pass
			} );
		} else {
			warn("Session expired");
			endSession( req, res );
		}
		next();
		ret = true;
	} else {
		warn("No previous session user found");
		ret = false;
	}

	return ret;
},
tryStartSessionWithAuthToken = function ( req, res, next ) {
	var auth = getAuthTokenFromHeaders( req ), ret;
	warn("Try Session with Auth Token for "+req.url);	
	if ( auth ) {
		warn("Auth Token found");
		if ( auth.valid ) {
			warn("Previous session believed to be valid, checking...");
			var context = {
				req: req,
				res: res,
				next: next,
				auth: auth
			};

			if ( validate ) {
				warn("Trying with validate...");
				validate( auth.user, undefined, validateWithAuthTokenCallback.bind( context ) );
			} else if ( getUser ) {
				warn("Trying with getUser");
				getUser(
					auth.user,
					validateGetUserSuccessCallback.bind( context ),
					validateGetUserFailureCallback.bind( context )
				);
			}
		} else {
			warn("Previous session not found valid");
			endSessionWithErrorMessage( req, res, errors.invalidtoken() );
			next();
		}
		ret = true;
	} else {
		warn("No auth token found");
		ret = false;
	}
	return ret;
};



/////////////////
//// METHODS ////
/////////////////

publicMethods = {
	// if there is a login session token, refresh its timeout on each request, and validate it
	validate: function ( req, res, next ) {
		"use strict";
  
		return tryStartSessionWithBasicAuthCredentials( req, res, next ) ||
			tryStartWithPreviousSessionData( req, res, next ) ||
			tryStartSessionWithAuthToken( req, res, next ) ||
			cantStablishSession( req, res, next );
	},
	clear: endSession,
	message: function ( res ) {
		var msg, p = res.headers ? ( res.headers[ AUTHHEADER ] || res.headers[ AUTHHEADER.toLowerCase() ] || "" ) : "",
			match = MSGRE.exec( p );

		msg = match && match.length > 1 && match[ 1 ].length > 0 ? match[ 1 ] : "";
		return ( msg );
	},
	getAuthMethod: function ( req ) {
      
		return ( req ? req[ AUTHMETHODHEADER ] : null );
	},
	getUser: function ( req ) {
		if ( req ) {
			return encryptHeader ? tokenlib.cipher( req[ AUTHHEADER ] ) : req[ AUTHHEADER ];
		}
		return null;
	}
};

module.exports = {
	init: function ( config ) {
       // console.log("am in config manager");
		validate = fnOrNull( config.validate );
        authCallback =fnOrNull(config.authCallback);
        fbValidate = fnOrNull(config.fbValidate);
		getUser = fnOrNull( config.getUser );
		CUST_AUTH_HDR=config.AUTH_HDR||"HIM";
        if(fbValidate)
          graph= require('fbgraph');
        
		validatePass = fnOrNull( config.validatePassword );
		sessionExpiry = ( config.expiry || SESSIONEXPIRY ) * 60 * 1000;
		encryptHeader = ( config.encryptHeader || false );
		tokenlib.init( config.sessionKey || genRandomString( RANDOM_STRING_LENGTH ), encryptHeader );
		debug = config.debug || false;
		hasInit = true;
		return publicMethods;
	}
};
